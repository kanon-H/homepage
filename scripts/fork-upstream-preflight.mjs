import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const FORK = "kanon-H/homepage";
export const UPSTREAM = "https://github.com/gethomepage/homepage.git";
const SHA = /^[0-9a-f]{40}$/;

export class PreflightError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function validSha(value) {
  if (typeof value !== "string" || !SHA.test(value)) throw new PreflightError("invalid-commit-sha");
  return value;
}

// Public upstream only: no inherited Git credentials, hooks, tracing or global drivers.
export function gitCommand(cwd, args, accepted = [0]) {
  const env = {};
  for (const key of [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "all_proxy",
    "no_proxy",
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/false",
    SSH_ASKPASS: "/bin/false",
    GIT_TRACE: "0",
    GIT_TRACE_CURL: "0",
    GIT_CURL_VERBOSE: "0",
  });
  const result = spawnSync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.attributesFile=/dev/null",
      "-c",
      "credential.helper=",
      "-c",
      "http.extraHeader=",
      "-c",
      "http.followRedirects=false",
      ...args,
    ],
    { cwd, env, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.error || !accepted.includes(result.status)) {
    // Never echo subprocess stderr, arguments, environment or credentials.
    throw new PreflightError("git-operation-failed");
  }
  return { status: result.status, output: result.stdout };
}

function safeRepository(cwd, run) {
  const config = run(
    cwd,
    [
      "config",
      "--local",
      "--name-only",
      "--get-regexp",
      "^(include|merge\\.|filter\\.|diff\\.external|http\\.|credential\\.|url\\.)",
    ],
    [0, 1],
  );
  if (config.status === 0) throw new PreflightError("custom-git-config-not-supported");
}

export function parseUpstreamRef(text) {
  const match = /^([0-9a-f]{40})\trefs\/heads\/main\n?$/.exec(text);
  if (!match) throw new PreflightError("invalid-upstream-main-ref");
  return match[1];
}

export function fetchUpstreamMain(cwd, run = gitCommand) {
  safeRepository(cwd, run);
  const sha = parseUpstreamRef(run(cwd, ["ls-remote", "--exit-code", "--heads", UPSTREAM, "refs/heads/main"]).output);
  // Fetch only objects for the observed main SHA: no tags, FETCH_HEAD or refs.
  run(cwd, [
    "fetch",
    "--no-tags",
    "--no-write-fetch-head",
    "--no-recurse-submodules",
    "--refmap=",
    "--no-auto-maintenance",
    UPSTREAM,
    sha,
  ]);
  return sha;
}

export function analyzeMerge(cwd, mainSha, upstreamSha, run = gitCommand) {
  validSha(mainSha);
  validSha(upstreamSha);
  safeRepository(cwd, run);
  for (const sha of [mainSha, upstreamSha]) {
    if (run(cwd, ["cat-file", "-t", sha]).output.trim() !== "commit") throw new PreflightError("object-is-not-commit");
  }
  const result = {
    main_sha: mainSha,
    upstream_sha: upstreamSha,
    upstream_ref: "refs/heads/main",
    mode: "read-only-preflight",
    candidate_tree_sha: null,
    conflicts: [],
  };
  if (run(cwd, ["merge-base", "--is-ancestor", upstreamSha, mainSha], [0, 1]).status === 0) {
    return { ...result, outcome: "up-to-date" };
  }
  const bases = run(cwd, ["merge-base", "--all", mainSha, upstreamSha], [0, 1]);
  if (bases.status === 1) return { ...result, outcome: "unrelated-histories" };
  const merge = run(
    cwd,
    ["merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", mainSha, upstreamSha],
    [0, 1],
  );
  const [tree, ...fields] = merge.output.split("\0");
  validSha(tree);
  if (merge.status === 0) return { ...result, outcome: "clean-merge", candidate_tree_sha: tree };
  const end = fields.indexOf("");
  const conflicts = end === -1 ? fields : fields.slice(0, end);
  if (!conflicts.length) throw new PreflightError("unrecognized-conflict-output");
  // A conflicted merge-tree is not a candidate that may be published.
  return { ...result, outcome: "conflict", conflicts };
}

export function validateContext(env) {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_REPOSITORY !== FORK ||
    env.GITHUB_REF !== "refs/heads/main" ||
    !["schedule", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME)
  ) {
    throw new PreflightError("trusted-main-workflow-required");
  }
  validSha(env.EXPECTED_MAIN_SHA);
  if (!env.GITHUB_WORKSPACE) throw new PreflightError("workspace-required");
  return { cwd: resolve(env.GITHUB_WORKSPACE), mainSha: env.EXPECTED_MAIN_SHA };
}

export function runPreflight(env, run = gitCommand) {
  const { cwd, mainSha } = validateContext(env);
  if (
    resolve(run(cwd, ["rev-parse", "--show-toplevel"]).output.trim()) !== cwd ||
    run(cwd, ["rev-parse", "HEAD"]).output.trim() !== mainSha
  )
    throw new PreflightError("checkout-snapshot-mismatch");
  if (run(cwd, ["remote", "get-url", "origin"]).output.trim() !== `https://github.com/${FORK}.git`) {
    throw new PreflightError("fork-origin-required");
  }
  return analyzeMerge(cwd, mainSha, fetchUpstreamMain(cwd, run), run);
}

export function preflightExitCode(result) {
  return ["up-to-date", "clean-merge"].includes(result.outcome) ? 0 : 1;
}

function report(value) {
  const json = JSON.stringify(value, null, 2);
  console.log(json);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Upstream main preflight (read-only)\n\n\`\`\`json\n${json}\n\`\`\`\n\nNo refs, commits, PRs or images are published. A tree SHA is not a CI source commit.\n`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = runPreflight(process.env);
    report(result);
    process.exitCode = preflightExitCode(result);
  } catch (error) {
    report({ outcome: "error", code: error instanceof PreflightError ? error.code : "preflight-failed" });
    process.exitCode = 1;
  }
}
