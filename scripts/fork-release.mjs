import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchUpstreamMain, gitCommand } from "./fork-upstream-preflight.mjs";

export const REPOSITORY = "kanon-H/homepage";
// Single source of truth for the shipped platforms. arm64 is intentionally absent:
// Next.js compilation dies under the Actions QEMU emulation (SIGILL). Restoring it
// requires cross-compiling with BUILDPLATFORM, not wider retries or weaker checks.
export const PLATFORMS = ["amd64"];
export const RELEASE_FILES = [
  ".github/workflows/fork-release.yml",
  ".github/workflows/fork-release-tag.yml",
  "Dockerfile.fork",
  "Dockerfile.fork.dockerignore",
  "scripts/fork-ci-build.sh",
  "scripts/fork-upstream-preflight.mjs",
  "scripts/fork-image-context.mjs",
  "scripts/fork-release.mjs",
  "scripts/fork-image-publish.mjs",
  "scripts/fork-image-smoke.mjs",
  "scripts/fork-image-http.mjs",
];
export const isSha = (value) => typeof value === "string" && value.length === 40 && /^[0-9a-f]{40}$/.test(value);
export const isVersion = (value) =>
  typeof value === "string" &&
  !/[\r\n]/.test(value) &&
  /^fork-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) &&
  value.length <= 64;

export function requireRelease(condition, code) {
  if (!condition) throw new Error(code);
}

export function releaseContext(env) {
  requireRelease(
    env.GITHUB_REPOSITORY === REPOSITORY &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REF === "refs/heads/main" &&
      env.GITHUB_WORKFLOW_REF === `${REPOSITORY}/.github/workflows/fork-release.yml@refs/heads/main` &&
      isSha(env.GITHUB_SHA),
    "UNTRUSTED_RELEASE_CONTEXT",
  );
  requireRelease(["true", "false"].includes(env.RELEASE_PUBLISH), "INVALID_PUBLISH_INPUT");
  const publish = env.RELEASE_PUBLISH === "true";
  const version = env.RELEASE_VERSION || "";
  requireRelease(!version || isVersion(version), "INVALID_VERSION_TAG");
  requireRelease(
    !publish || (isVersion(version) && env.RELEASE_ENABLED === "true" && env.GITHUB_RUN_ATTEMPT === "1"),
    "PUBLISH_DISABLED_OR_REPEATED",
  );
  return { publish, version, main_sha: env.GITHUB_SHA };
}

export async function githubGet(path, token, fetcher = fetch) {
  requireRelease(path.startsWith(`/repos/${REPOSITORY}/`), "INVALID_API_PATH");
  try {
    const response = await fetcher(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    requireRelease(response.ok, "GITHUB_READ_FAILED");
    return await response.json();
  } catch {
    throw new Error("GITHUB_READ_FAILED");
  }
}

export async function verifyReleaseEnvironment(get) {
  const environment = await get(`/repos/${REPOSITORY}/environments/dockerhub-release`);
  requireRelease(
    environment.deployment_branch_policy?.custom_branch_policies === true &&
      environment.deployment_branch_policy?.protected_branches === false,
    "ENVIRONMENT_NOT_MAIN_ONLY",
  );
  const policies = await get(`/repos/${REPOSITORY}/environments/dockerhub-release/deployment-branch-policies`);
  requireRelease(
    Array.isArray(policies.branch_policies) &&
      policies.branch_policies.length === 1 &&
      policies.branch_policies[0].name === "main" &&
      policies.branch_policies[0].type === "branch",
    "ENVIRONMENT_NOT_MAIN_ONLY",
  );
}

export async function verifyReleaseSource(
  cwd,
  env,
  get = (path) => githubGet(path, env.GITHUB_TOKEN),
  run = gitCommand,
) {
  const context = releaseContext(env);
  const git = (args, accepted) => run(cwd, args, accepted);
  requireRelease(git(["rev-parse", "HEAD"]).output.trim() === context.main_sha, "CONTROLLER_HEAD_MISMATCH");
  requireRelease(
    [`https://github.com/${REPOSITORY}`, `https://github.com/${REPOSITORY}.git`].includes(
      git(["remote", "get-url", "origin"]).output.trim(),
    ),
    "WRONG_FORK",
  );
  const main = await get(`/repos/${REPOSITORY}/branches/main`);
  requireRelease(main.commit?.sha === context.main_sha, "MAIN_MOVED");
  if (context.publish) await verifyReleaseEnvironment(get);
  let source = context.main_sha;
  if (context.version) {
    const tagRef = await get(`/repos/${REPOSITORY}/git/ref/tags/${context.version}`);
    let ref = tagRef.object;
    for (let depth = 0; ref?.type === "tag" && depth < 4; depth += 1) {
      requireRelease(isSha(ref.sha), "INVALID_TAG_OBJECT");
      const tagObject = await get(`/repos/${REPOSITORY}/git/tags/${ref.sha}`);
      ref = tagObject.object;
    }
    requireRelease(ref?.type === "commit" && isSha(ref.sha), "INVALID_TAG_OBJECT");
    source = git(["rev-parse", "--verify", `refs/tags/${context.version}^{commit}`]).output.trim();
    requireRelease(source === ref.sha && isSha(source), "TAG_MOVED");
    requireRelease(
      git(["merge-base", "--is-ancestor", source, context.main_sha], [0, 1]).status === 0,
      "SOURCE_NOT_ON_MAIN",
    );
    for (const file of RELEASE_FILES) {
      const controllerBlob = git(["rev-parse", `${context.main_sha}:${file}`]).output.trim();
      requireRelease(
        isSha(controllerBlob) && controllerBlob === git(["rev-parse", `${source}:${file}`]).output.trim(),
        "RELEASE_INFRASTRUCTURE_CHANGED",
      );
    }
  }
  return { ...context, source_sha: source, version: context.version || `validation-${source}` };
}

export async function prepareRelease(cwd, env, get, run = gitCommand, upstream = fetchUpstreamMain) {
  const plan = await verifyReleaseSource(cwd, env, get, run);
  const observed = upstream(cwd, run);
  requireRelease(isSha(observed), "INVALID_UPSTREAM");
  const base = run(cwd, ["merge-base", plan.source_sha, observed]).output.trim();
  requireRelease(isSha(base), "NO_UPSTREAM_BASE");
  return { ...plan, upstream_sha: base, observed_upstream_sha: observed, created: new Date().toISOString() };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const plan = await prepareRelease(process.cwd(), process.env);
    for (const [key, value] of Object.entries(plan)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    console.log(JSON.stringify(plan));
  } catch {
    console.error("Release planning failed; no registry login or publication attempted.");
    process.exitCode = 1;
  }
}
