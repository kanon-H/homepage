import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, createReadStream, lstatSync, openSync, statfsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isSha, isVersion, PLATFORMS, REPOSITORY, requireRelease, verifyReleaseSource } from "./fork-release.mjs";

export function parseMetadata(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("INVALID_IMAGE_METADATA");
  }
}

export function imageName(username, configured) {
  requireRelease(
    typeof username === "string" && /^[a-z0-9][a-z0-9_-]{1,63}$/.test(username),
    "INVALID_DOCKERHUB_USERNAME",
  );
  const image = configured || `${username}/homepage`;
  requireRelease(
    typeof image === "string" &&
      image.length <= 200 &&
      /^[a-z0-9][a-z0-9_-]{1,63}\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/.test(image),
    "INVALID_DOCKERHUB_IMAGE",
  );
  return image;
}

export function runTool(command, args, authFd) {
  const result = spawnSync(command, args, {
    env: { PATH: process.env.PATH, HOME: "/nonexistent", LANG: "C.UTF-8" },
    stdio: authFd === undefined ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe", authFd],
    encoding: "utf8",
    timeout: 20 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
  });
  requireRelease(!result.error && result.status === 0, "IMAGE_TOOL_FAILED");
  return result.stdout;
}

export async function fileDigest(path) {
  requireRelease(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), "INVALID_ARCHIVE");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function inspectArchive(archive, plan, tool = runTool) {
  const raw = tool("skopeo", ["inspect", "--raw", `oci-archive:${archive}`]);
  let index = parseMetadata(raw);
  // buildx may wrap the platform list in an extra annotations-only index.
  if (Array.isArray(index.manifests) && index.manifests.length === 1 && !index.manifests[0].platform) {
    const inner = index.manifests[0].digest;
    requireRelease(/^sha256:[0-9a-f]{64}$/.test(inner || ""), "EXPECTED_PLATFORMS");
    index = parseMetadata(tool("tar", ["-xOf", archive, `blobs/sha256/${inner.slice(7)}`]));
  }
  requireRelease(Array.isArray(index.manifests), "EXPECTED_PLATFORMS");
  // Attestation/provenance manifests carry platform unknown/unknown. They are not
  // runnable images, so select real linux manifests explicitly instead of demanding a
  // fixed entry count. The shipped set comes from PLATFORMS so the workflow, the
  // archive check and the runtime smoke can never disagree about what was built.
  const platforms = index.manifests.filter((m) => m.platform?.os === "linux" && m.platform?.architecture);
  requireRelease(
    platforms.length === PLATFORMS.length &&
      PLATFORMS.every((arch) => platforms.some((m) => m.platform.architecture === arch)),
    "WRONG_IMAGE_PLATFORMS",
  );
  requireRelease(
    index.manifests.every((m) => !m.platform || m.platform.os === "linux" || m.platform.os === "unknown"),
    "WRONG_IMAGE_PLATFORMS",
  );
  for (const arch of PLATFORMS) {
    const config = parseMetadata(
      tool("skopeo", [
        "inspect",
        "--config",
        "--override-os",
        "linux",
        "--override-arch",
        arch,
        `oci-archive:${archive}`,
      ]),
    );
    const labels = config.config?.Labels;
    requireRelease(
      config.os === "linux" &&
        config.architecture === arch &&
        labels?.["org.opencontainers.image.revision"] === plan.source_sha &&
        labels?.["org.opencontainers.image.version"] === plan.version &&
        labels?.["org.opencontainers.image.source"] === `https://github.com/${REPOSITORY}` &&
        labels?.["org.opencontainers.image.created"] === plan.created &&
        labels?.["org.opencontainers.image.licenses"] === "GPL-3.0-only" &&
        labels?.["io.homepage.fork.upstream-revision"] === plan.upstream_sha,
      "IMAGE_LABEL_MISMATCH",
    );
  }
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

// Linux tmpfs, unlinked BEFORE writing credentials; only the inherited FD contains them.
// No token in argv, child environment, Docker config or named/on-disk auth file.
export async function withRegistryAuth(username, token, callback) {
  requireRelease(process.platform === "linux" && statfsSync("/dev/shm").type === 0x01021994, "MEMORY_AUTH_UNAVAILABLE");
  const path = `/dev/shm/homepage-registry-${randomUUID()}`;
  const fd = openSync(path, "wx", 0o600);
  try {
    unlinkSync(path);
    writeFileSync(
      fd,
      JSON.stringify({ auths: { "docker.io": { auth: Buffer.from(`${username}:${token}`).toString("base64") } } }),
    );
    return await callback(fd);
  } finally {
    closeSync(fd);
  }
}

export async function registryToken(image, username, token, fetcher = fetch) {
  try {
    const scope = encodeURIComponent(`repository:${image}:pull,push`);
    const response = await fetcher(`https://auth.docker.io/token?service=registry.docker.io&scope=${scope}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    requireRelease(response.ok, "REGISTRY_AUTH_FAILED");
    const data = await response.json();
    requireRelease(
      typeof data.token === "string" && data.token.length > 0 && !/[\r\n]/.test(data.token),
      "REGISTRY_AUTH_FAILED",
    );
    return data.token;
  } catch {
    throw new Error("REGISTRY_AUTH_FAILED");
  }
}

export async function registryManifest(image, tag, token, fetcher = fetch) {
  try {
    const response = await fetcher(`https://registry-1.docker.io/v2/${image}/manifests/${tag}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json();
    if (
      response.status === 404 &&
      Array.isArray(data.errors) &&
      data.errors.length > 0 &&
      data.errors.every((e) => e.code === "MANIFEST_UNKNOWN")
    )
      return null;
    requireRelease(
      response.status === 200 && /^sha256:[0-9a-f]{64}$/.test(response.headers.get("docker-content-digest") || ""),
      "REGISTRY_READ_FAILED",
    );
    return { digest: response.headers.get("docker-content-digest"), manifest: data };
  } catch {
    throw new Error("REGISTRY_READ_FAILED");
  }
}

export async function publishArchive({ archive, plan, image, username, token, archiveSha }, deps = {}) {
  const tool = deps.tool || runTool;
  const readManifest = deps.readManifest || registryManifest;
  const getToken = deps.getToken || registryToken;
  const auth = deps.auth || withRegistryAuth;
  requireRelease(
    isVersion(plan.version) &&
      isSha(plan.source_sha) &&
      isSha(plan.upstream_sha) &&
      typeof plan.created === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(plan.created),
    "INVALID_RELEASE_PLAN",
  );
  requireRelease(
    imageName(username, image) === image && typeof token === "string" && token.length > 0,
    "MISSING_REGISTRY_CREDENTIALS",
  );
  requireRelease(
    /^[0-9a-f]{64}$/.test(archiveSha || "") && (await (deps.digest || fileDigest)(archive)) === archiveSha,
    "ARCHIVE_DIGEST_MISMATCH",
  );
  const digest = inspectArchive(archive, plan, tool);
  const access = await getToken(image, username, token);
  const tags = [plan.version, `sha-${plan.source_sha}`];
  // Only an explicit MANIFEST_UNKNOWN is absence; auth/network/unknown errors stop publication.
  for (const tag of tags) requireRelease((await readManifest(image, tag, access)) === null, "IMAGE_TAG_ALREADY_EXISTS");
  await auth(username, token, async (fd) => {
    for (const tag of tags) {
      // Exactly one copy attempt. A failed/unknown response may have published a partial release.
      tool(
        "skopeo",
        [
          "copy",
          "--all",
          "--preserve-digests",
          "--retry-times=0",
          "--authfile=/proc/self/fd/3",
          `oci-archive:${archive}`,
          `docker://docker.io/${image}:${tag}`,
        ],
        fd,
      );
      const actual = await readManifest(image, tag, access);
      requireRelease(actual?.digest === digest, "PUBLISHED_DIGEST_MISMATCH");
    }
  });
  return {
    image: `docker.io/${image}`,
    tags,
    digest,
    source_sha: plan.source_sha,
    upstream_sha: plan.upstream_sha,
    version: plan.version,
    created: plan.created,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    // Only trusted main controller code runs here. Never run scripts from the downloaded OCI artifact.
    const source = await verifyReleaseSource(process.cwd(), process.env);
    requireRelease(source.publish && source.source_sha === process.env.RELEASE_SOURCE_SHA, "PUBLISH_SOURCE_MISMATCH");
    const plan = { ...source, upstream_sha: process.env.RELEASE_UPSTREAM_SHA, created: process.env.RELEASE_CREATED };
    const result = await publishArchive({
      archive: process.env.RELEASE_ARCHIVE,
      plan,
      image: imageName(process.env.DOCKERHUB_USERNAME, process.env.DOCKERHUB_IMAGE),
      username: process.env.DOCKERHUB_USERNAME,
      token: process.env.DOCKERHUB_TOKEN,
      archiveSha: process.env.RELEASE_ARCHIVE_SHA256,
    });
    writeFileSync(process.env.RELEASE_RECORD, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result));
  } catch {
    console.error(
      "Publication failed or is unconfirmed. Inspect registry tags/digests and the run; do not blindly retry or overwrite tags.",
    );
    process.exitCode = 1;
  }
}
