import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectArchive, runTool } from "./fork-image-publish.mjs";

export function smokeArchive(archive, plan, tool = runTool) {
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
    const image = `homepage-fork-smoke-${process.pid}:${arch}`;
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
    } finally {
      if (loaded) tool("docker", ["image", "rm", image]);
    }
  }
  return digest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const digest = smokeArchive(process.env.RELEASE_ARCHIVE, {
      source_sha: process.env.RELEASE_SOURCE_SHA,
      version: process.env.RELEASE_VERSION,
      upstream_sha: process.env.RELEASE_UPSTREAM_SHA,
      created: process.env.RELEASE_CREATED,
    });
    console.log(`Both platform runtime structures verified: ${digest}`);
  } catch {
    console.error("OCI platform, labels or runtime structure verification failed; no publication attempted.");
    process.exitCode = 1;
  }
}
