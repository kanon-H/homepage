import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyApplication } from "./fork-image-http.mjs";
import { fileDigest, inspectArchive, runTool } from "./fork-image-publish.mjs";
import { requireRelease } from "./fork-release.mjs";

export async function smokeArchive(archive, plan, deps = {}) {
  const tool = deps.tool || runTool;
  const application = deps.application || verifyApplication;
  const hash = deps.hash || fileDigest;
  const report = deps.report || ((result) => console.log(JSON.stringify(result)));
  const archiveSha = await hash(archive);
  const digest = inspectArchive(archive, plan, tool);
  const check = `
    const fs = require('node:fs');
    if (process.version !== 'v24.22.1') throw Error('Wrong Node version');
    require('next/package.json');
    for (const path of ['/app/server.js', '/app/.next/static', '/usr/share/doc/homepage/LICENSE']) {
      if (!fs.existsSync(path)) throw Error('Missing runtime file');
    }
    if (fs.existsSync('/app/config') && fs.readdirSync('/app/config').length) throw Error('Unexpected baked config');
    if (fs.existsSync('/app/.env') || fs.existsSync('/app/.env.local')) throw Error('Unexpected environment file');
  `;
  for (const arch of ["amd64", "arm64"]) {
    const image = `homepage-fork-smoke-${randomUUID()}:${arch}`;
    let loaded = false;
    try {
      tool("skopeo", [
        "copy",
        "--override-os",
        "linux",
        "--override-arch",
        arch,
        `oci-archive:${archive}`,
        `docker-daemon:${image}`,
      ]);
      loaded = true;
      tool("docker", [
        "run",
        "--rm",
        "--platform",
        `linux/${arch}`,
        "--network",
        "none",
        "--read-only",
        "--user",
        "1000:1000",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--entrypoint",
        "node",
        image,
        "-e",
        check,
      ]);
      const results = await application(image, arch);
      requireRelease(
        results.length === 2 && results.every((result) => result.healthy && result.checks > 0),
        "APPLICATION_SMOKE_INCOMPLETE",
      );
      for (const result of results) report(result);
    } finally {
      if (loaded) tool("docker", ["image", "rm", image]);
    }
  }
  requireRelease((await hash(archive)) === archiveSha, "SMOKE_ARCHIVE_CHANGED");
  return digest;
}

// Keep the scrubbed diagnostic raised by the tools: it is already secret-free
// (credential material only ever travels through stdin). Anything unexpected is
// collapsed to a stable code so no raw payload can reach the log.
export function verificationFailureCode(error) {
  const raw = String(error?.message || "");
  return /^[A-Z0-9_]/.test(raw) && /^[A-Za-z0-9_:/.<>\s-]+$/.test(raw) && raw.length <= 400
    ? raw
    : "IMAGE_VERIFICATION_FAILED";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const digest = await smokeArchive(process.env.RELEASE_ARCHIVE, {
      source_sha: process.env.RELEASE_SOURCE_SHA,
      version: process.env.RELEASE_VERSION,
      upstream_sha: process.env.RELEASE_UPSTREAM_SHA,
      created: process.env.RELEASE_CREATED,
    });
    console.log(
      `Both platform runtime structures and application HTTP/password/Host/mount/identity/health gates verified: ${digest}`,
    );
  } catch (error) {
    const code = verificationFailureCode(error);
    console.error(`OCI/application verification failed (${code}); no publication attempted. Do not rerun blindly.`);
    process.exitCode = 1;
  }
}
