import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isSha, requireRelease } from "./fork-release.mjs";
import { GIT_OPTIONS, gitCommand, gitEnvironment } from "./fork-upstream-preflight.mjs";

const rootFiles = new Set([
  "Dockerfile.fork",
  "Dockerfile.fork.dockerignore",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "next.config.js",
  "next-i18next.config.js",
  "jsconfig.json",
  "postcss.config.js",
  "docker-entrypoint.sh",
  "LICENSE",
]);

export function allowedContextPath(path) {
  if (
    typeof path !== "string" ||
    /[\x00-\x1f\x7f]/.test(path) ||
    path
      .split("/")
      .some((part) => [".", "..", ".git", "node_modules", "__tests__", "__fixtures__", "test-utils"].includes(part))
  )
    return false;
  if (/(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx|jks)$|\.test\.[^/]+$|(?:^|\/)secrets?(?:[.-]|$)/i.test(path))
    return false;
  return (
    rootFiles.has(path) || path === "scripts/fork-ci-build.sh" || path.startsWith("src/") || path.startsWith("public/")
  );
}

export function createImageContext(cwd, sha, destination) {
  requireRelease(isSha(sha) && gitCommand(cwd, ["rev-parse", "HEAD"]).output.trim() === sha, "CONTEXT_SOURCE_MISMATCH");
  requireRelease(!existsSync(destination), "CONTEXT_ALREADY_EXISTS");
  const files = gitCommand(cwd, ["ls-tree", "-rz", "--full-tree", sha])
    .output.split("\0")
    .filter(Boolean)
    .map((entry) => {
      const split = entry.indexOf("\t");
      return { mode: entry.slice(0, split).split(" ")[0], path: entry.slice(split + 1) };
    })
    .filter((entry) => allowedContextPath(entry.path));
  requireRelease(
    files.length > 0 && files.every((entry) => ["100644", "100755"].includes(entry.mode)),
    "UNSAFE_CONTEXT_FILE_MODE",
  );
  requireRelease(
    [...rootFiles, "scripts/fork-ci-build.sh"].every((path) => files.some((entry) => entry.path === path)),
    "CONTEXT_INPUT_MISSING",
  );
  const archive = spawnSync(
    "git",
    [...GIT_OPTIONS, "--literal-pathspecs", "archive", "--format=tar", sha, "--", ...files.map((entry) => entry.path)],
    {
      cwd,
      env: gitEnvironment(),
      timeout: 120000,
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  requireRelease(!archive.error && archive.status === 0, "CONTEXT_ARCHIVE_FAILED");
  mkdirSync(destination, { recursive: true });
  const extract = spawnSync(
    "tar",
    ["--extract", "--no-same-owner", "--no-same-permissions", "--directory", destination],
    {
      input: archive.stdout,
      env: { PATH: process.env.PATH },
      timeout: 120000,
    },
  );
  requireRelease(!extract.error && extract.status === 0, "CONTEXT_EXTRACTION_FAILED");
  return files.map((entry) => entry.path);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const files = createImageContext(
      process.cwd(),
      process.env.RELEASE_SOURCE_SHA,
      `${process.env.RUNNER_TEMP}/fork-release/context`,
    );
    console.log(
      `Prepared ${files.length} allowlisted tracked source files; no working-tree config, environment or prebuilt output copied.`,
    );
  } catch {
    console.error("Clean source context preparation failed; no image built or published.");
    process.exitCode = 1;
  }
}
