import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { load } from "js-yaml";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CI_DIGEST,
  CI_PATH,
  createGit,
  createGithub,
  notifyFailure,
  pushCandidate,
  runSync,
  validateWriteContext,
  verifyCi,
} from "../../../scripts/fork-upstream-integrate.mjs";
import { analyzeMerge, FORK, gitEnvironment } from "../../../scripts/fork-upstream-preflight.mjs";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const CI = readFileSync(join(root, CI_PATH), "utf8");
const MAIN = "a".repeat(40),
  UP = "b".repeat(40),
  HEAD = "c".repeat(40),
  TREE = "d".repeat(40);
const BRANCH = `sync/upstream-main-${UP}`;
const BOT = "github-actions[bot]";
const RUN_URL = `https://github.com/${FORK}/actions/runs/1`;
const names = [
  "Verify tool versions and source",
  "Install frozen dependencies",
  "Lint",
  "Test",
  "Build with isolated fictional configuration",
];
const temporary = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function pr(overrides = {}) {
  return {
    number: 7,
    state: "open",
    draft: true,
    merged: false,
    merged_at: null,
    auto_merge: null,
    head: { repo: { full_name: FORK }, ref: BRANCH, sha: HEAD },
    base: { repo: { full_name: FORK }, ref: "main" },
    body: `<!-- homepage-upstream-pr:${UP} -->`,
    ...overrides,
  };
}

function harness() {
  let tick = 0;
  const state = {
    main: MAIN,
    ref: null,
    pulls: [],
    comments: [],
    issues: [],
    run: null,
    workflow: { path: CI_PATH, state: "active" },
    job: {
      id: 19,
      check_run_url: `https://api.github.com/repos/${FORK}/check-runs/29`,
      name: "Fork verification",
      head_sha: HEAD,
      status: "completed",
      conclusion: "success",
      steps: names.map((name) => ({ name, status: "completed", conclusion: "success" })),
    },
    check: {
      id: 29,
      name: "Fork verification",
      head_sha: HEAD,
      app: { id: 15368, slug: "github-actions" },
      status: "completed",
      conclusion: "success",
    },
  };
  const successRun = () => ({
    id: 12,
    status: "completed",
    conclusion: "success",
    head_sha: HEAD,
    head_repository: { full_name: FORK },
    head_branch: BRANCH,
    path: CI_PATH,
    event: "workflow_dispatch",
  });
  const github = {
    request: vi.fn(async (method, resource, body) => {
      const path = resource.split("?")[0];
      if (method === "GET") {
        if (resource === "") return { full_name: FORK, fork: true, private: false, default_branch: "main" };
        if (path === "git/ref/heads/main") return { object: { sha: state.main } };
        if (path === `git/ref/heads/${BRANCH}`) return state.ref ? { object: { sha: state.ref } } : null;
        if (path === "pulls") return state.pulls;
        if (path === "pulls/7") return state.pulls.find((p) => p.number === 7);
        if (path === "actions/workflows/fork-ci.yml") return state.workflow;
        if (path === "actions/workflows/fork-ci.yml/runs") return { workflow_runs: state.run ? [state.run] : [] };
        if (path === "actions/runs/12/jobs") return { jobs: [state.job] };
        if (path === "check-runs/29") return state.check;
        if (path === "issues/7/comments") return state.comments;
        if (path === "issues") return state.issues;
      }
      if (method === "POST") {
        if (path === "pulls") {
          const value = pr({ body: body.body });
          state.pulls.push(value);
          return value;
        }
        if (path === "issues/7/comments") {
          const value = { id: 3, body: body.body, user: { login: BOT } };
          state.comments.push(value);
          return value;
        }
        if (path === "actions/workflows/fork-ci.yml/dispatches") {
          state.run = successRun();
          return null;
        }
        if (path === "issues") {
          const value = { number: 9, ...body, user: { login: BOT } };
          state.issues.push(value);
          return value;
        }
      }
      throw new Error(`Unexpected mocked route: ${method} ${path}`);
    }),
  };
  const git = {
    plan: vi.fn(() => ({ outcome: "clean-merge", main_sha: MAIN, upstream_sha: UP, candidate_tree_sha: TREE })),
    file: vi.fn(() => CI),
    fetch: vi.fn(),
    inspect: vi.fn(() => ({ tree: TREE, parents: [MAIN, UP] })),
    commit: vi.fn(() => HEAD),
    push: vi.fn(() => {
      state.ref = HEAD;
    }),
  };
  const ciOptions = {
    now: () => tick,
    wait: vi.fn(async () => {
      tick += 15_000;
    }),
    timeoutMs: 45_000,
  };
  const execute = () => runSync({ github, git, main: MAIN, runUrl: RUN_URL, ciOptions });
  const writes = (path) =>
    github.request.mock.calls.filter(([method, resource]) => method !== "GET" && (!path || resource === path));
  return { state, github, git, ciOptions, execute, writes, successRun };
}

describe("integration workflow and authority boundary", () => {
  it("uses trusted main, explicit manual consent or default-off schedule, and no release authority", () => {
    const workflow = load(readFileSync(join(root, ".github/workflows/fork-upstream-integrate.yml"), "utf8"));
    expect(Object.keys(workflow.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch.inputs.create_pr).toMatchObject({
      type: "boolean",
      default: false,
      required: true,
    });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
    const job = workflow.jobs.integrate;
    expect(job.if).toContain("github.repository == 'kanon-H/homepage'");
    expect(job.if).toContain("github.ref == 'refs/heads/main'");
    expect(job.if).toContain("inputs.create_pr == true");
    expect(job.if).toContain("vars.FORK_UPSTREAM_SYNC_ENABLED == 'true'");
    expect(job.permissions).toEqual({ contents: "write", "pull-requests": "write", issues: "write", actions: "write" });
    expect(job.steps[0].with).toEqual({ ref: "${{ github.sha }}", "fetch-depth": 0, "persist-credentials": false });
    expect(job.steps[1].with).toEqual({ "node-version": "24.22.1" });
    expect(job.steps.at(-1).env).toEqual({
      EXPECTED_MAIN_SHA: "${{ github.sha }}",
      SYNC_WRITE_APPROVED: "true",
      SYNC_TOKEN: "${{ github.token }}",
    });
    for (const step of job.steps.filter((s) => s.uses)) expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
    expect(JSON.stringify(workflow)).not.toMatch(
      /pull_request_target|workflow_run|packages|id-token|secrets\.|continue-on-error/,
    );
  });

  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: FORK,
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKSPACE: root,
    EXPECTED_MAIN_SHA: MAIN,
    SYNC_WRITE_APPROVED: "true",
    GITHUB_RUN_ID: "1",
    GITHUB_WORKFLOW_REF: `${FORK}/.github/workflows/fork-upstream-integrate.yml@refs/heads/main`,
  };
  it("accepts only the declared trusted write entry", () => {
    expect(validateWriteContext(env)).toEqual({ cwd: root, mainSha: MAIN, runUrl: RUN_URL });
  });
  it.each([
    { SYNC_WRITE_APPROVED: "false" },
    { GITHUB_REF: "refs/heads/feature/test" },
    { GITHUB_EVENT_NAME: "pull_request_target" },
    { GITHUB_WORKFLOW_REF: `${FORK}/.github/workflows/other.yml@refs/heads/main` },
    { EXPECTED_MAIN_SHA: "main" },
    { GITHUB_RUN_ID: "$(touch bad)" },
  ])("rejects context %j", (override) => {
    expect(() => validateWriteContext({ ...env, ...override })).toThrow();
  });
  it("pins the exact known read-only CI definition", () => {
    expect(createHash("sha256").update(CI).digest("hex")).toBe(CI_DIGEST);
  });
  it("fails CLI closed before reading a token or calling Git/network in the wrong context", () => {
    const result = spawnSync(process.execPath, [join(root, "scripts/fork-upstream-integrate.mjs")], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, GITHUB_ACTIONS: "false", SYNC_TOKEN: "fixture-secret" },
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr).code).toBe("trusted-main-workflow-required");
    expect(result.stdout + result.stderr).not.toContain("fixture-secret");
  });
});

describe("scoped API and ephemeral push credentials", () => {
  it("uses a fixed Fork API origin and refuses credential redirects", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const api = createGithub("fixture-secret", fetcher);
    await api.request("GET", "git/ref/heads/main");
    expect(fetcher.mock.calls[0][0]).toBe(`https://api.github.com/repos/${FORK}/git/ref/heads/main`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      headers: { Authorization: "Bearer fixture-secret" },
    });
  });
  it.each([
    ["PUT", "pulls/1/merge", {}],
    ["PATCH", "git/refs/heads/main", { sha: HEAD }],
    ["DELETE", "git/refs/heads/main", undefined],
    ["POST", "actions/workflows/fork-ci.yml/dispatches", { ref: "main" }],
    ["POST", "pulls", { head: "kanon-H:main", base: "main", draft: true }],
    ["GET", "../gethomepage/homepage", undefined],
    ["GET", "https://example.invalid", undefined],
  ])("rejects API operation %s %s", async (method, path, body) => {
    const fetcher = vi.fn();
    await expect(createGithub("fixture-secret", fetcher).request(method, path, body)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("never retries an ambiguous POST or exposes the transport error", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("fixture-secret transport data");
    });
    await expect(
      createGithub("fixture-secret", fetcher).request("POST", "actions/workflows/fork-ci.yml/dispatches", {
        ref: BRANCH,
      }),
    ).rejects.toThrow("github-post-unconfirmed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not put push credentials in arguments, URLs, Git config files or inherited token variables", () => {
    vi.stubEnv("SYNC_TOKEN", "must-not-inherit");
    const spawn = vi.fn(() => ({ status: 0 }));
    pushCandidate(root, HEAD, BRANCH, "fixture-secret", spawn);
    const [, args, options] = spawn.mock.calls[0];
    expect(args).toContain("--no-force");
    expect(args).not.toContain("--force");
    expect(args.at(-2)).toBe(`https://github.com/${FORK}.git`);
    expect(args.at(-1)).toBe(`${HEAD}:refs/heads/${BRANCH}`);
    expect(JSON.stringify(args)).not.toContain("fixture-secret");
    expect(options.env.SYNC_TOKEN).toBeUndefined();
    expect(options.env.GIT_CONFIG_KEY_0).toBe(`http.https://github.com/${FORK}.git.extraHeader`);
    expect(options.env.GIT_CONFIG_VALUE_0).toContain(Buffer.from("x-access-token:fixture-secret").toString("base64"));
    expect(gitEnvironment().SYNC_TOKEN).toBeUndefined();
  });
  it.each(["main", "feature/multi-address", "sync/upstream-main-" + "A".repeat(40)])(
    "refuses push target %s",
    (branch) => {
      const spawn = vi.fn();
      expect(() => pushCandidate(root, HEAD, branch, "fixture-secret", spawn)).toThrow("invalid-push-target");
      expect(spawn).not.toHaveBeenCalled();
    },
  );
  it("does not echo push stderr with a credential on failure", () => {
    expect(() =>
      pushCandidate(root, HEAD, BRANCH, "fixture-secret", () => ({ status: 1, stderr: "fixture-secret" })),
    ).toThrow("git-push-unconfirmed");
  });
});

describe("mocked GitHub integration lifecycle (no remote writes)", () => {
  it("creates a two-parent candidate, draft PR, durable dispatch intent, and verifies exact-head CI", async () => {
    const h = harness();
    const result = await h.execute();
    expect(result).toMatchObject({
      outcome: "pr-ci-verified",
      pr_number: 7,
      ci: { run_id: 12, check_run_id: 29, head_sha: HEAD, conclusion: "success" },
    });
    expect(h.git.commit).toHaveBeenCalledWith(TREE, MAIN, UP);
    expect(h.git.push).toHaveBeenCalledWith(HEAD, BRANCH);
    expect(h.writes("pulls")[0][2]).toMatchObject({
      head: `kanon-H:${BRANCH}`,
      base: "main",
      draft: true,
      maintainer_can_modify: false,
    });
    expect(h.writes("issues/7/comments")).toHaveLength(1);
    expect(h.writes("actions/workflows/fork-ci.yml/dispatches")).toHaveLength(1);
    const paths = h.github.request.mock.calls.filter(([method]) => method === "POST").map(([, path]) => path);
    expect(paths.indexOf("issues/7/comments")).toBeLessThan(paths.indexOf("actions/workflows/fork-ci.yml/dispatches"));
    expect(paths.some((path) => path.includes("merge") || path.includes("protection"))).toBe(false);
  });
  it("reuses a known branch/PR and successful CI without duplicate writes", async () => {
    const h = harness();
    h.state.ref = HEAD;
    h.state.pulls = [pr()];
    h.state.run = h.successRun();
    await expect(h.execute()).resolves.toMatchObject({ outcome: "pr-ci-verified" });
    expect(h.git.fetch).toHaveBeenCalledWith(HEAD);
    expect(h.git.commit).not.toHaveBeenCalled();
    expect(h.git.push).not.toHaveBeenCalled();
    expect(h.writes()).toHaveLength(0);
  });
  it("has no writes when upstream is already in main", async () => {
    const h = harness();
    h.git.plan.mockReturnValue({ outcome: "up-to-date", main_sha: MAIN, upstream_sha: UP });
    await expect(h.execute()).resolves.toMatchObject({ outcome: "up-to-date" });
    expect(h.writes()).toHaveLength(0);
    expect(h.git.commit).not.toHaveBeenCalled();
  });
  it("respects a closed unmerged integration PR", async () => {
    const h = harness();
    h.state.pulls = [pr({ state: "closed" })];
    await expect(h.execute()).resolves.toMatchObject({ outcome: "declined" });
    expect(h.writes()).toHaveLength(0);
    expect(h.git.push).not.toHaveBeenCalled();
  });
  it("does not create multiple open upstream PRs for different upstream SHAs", async () => {
    const h = harness();
    const other = "e".repeat(40);
    h.state.pulls = [
      pr({
        head: { repo: { full_name: FORK }, ref: `sync/upstream-main-${other}`, sha: HEAD },
        body: `<!-- homepage-upstream-pr:${other} -->`,
      }),
    ];
    await expect(h.execute()).resolves.toMatchObject({ outcome: "pending-other-upstream-pr" });
    expect(h.writes()).toHaveLength(0);
  });
  it.each(["conflict", "unrelated-histories"])(
    "stops %s before push/PR and creates a diagnostic issue",
    async (outcome) => {
      const h = harness();
      h.git.plan.mockReturnValue({ outcome, main_sha: MAIN, upstream_sha: UP, conflicts: ["src/conflict.js"] });
      await expect(h.execute()).rejects.toThrow(outcome === "conflict" ? "merge-conflict" : "merge-not-safe");
      expect(h.git.push).not.toHaveBeenCalled();
      expect(h.writes("pulls")).toHaveLength(0);
      expect(h.state.issues[0].body).toContain("src/conflict.js");
      expect(h.state.issues[0].body).toContain(MAIN);
      expect(h.state.issues[0].body).toContain(UP);
    },
  );
  it("deduplicates bot-owned diagnostic issues including closed issues", async () => {
    const h = harness();
    h.state.issues = [
      { number: 11, state: "closed", user: { login: BOT }, body: `<!-- homepage-upstream-failure:${UP} -->` },
    ];
    expect(await notifyFailure(h.github, UP, MAIN, "merge-conflict", RUN_URL)).toBe(11);
    expect(h.writes()).toHaveLength(0);
  });
  it("does not use a public user's forged issue marker to suppress a real notification", async () => {
    const h = harness();
    h.state.issues = [{ number: 11, user: { login: "someone" }, body: `<!-- homepage-upstream-failure:${UP} -->` }];
    expect(await notifyFailure(h.github, UP, MAIN, "merge-conflict", RUN_URL)).toBe(9);
    expect(h.writes("issues")).toHaveLength(1);
  });
  it.each(["default", "candidate"])("refuses a changed %s CI definition before pushing", async (kind) => {
    const h = harness();
    h.git.file.mockImplementation((revision) =>
      kind === "default" || revision === TREE ? "unsafe changed workflow" : CI,
    );
    await expect(h.execute()).rejects.toThrow("ci-definition-review-required");
    expect(h.git.push).not.toHaveBeenCalled();
    expect(h.writes("pulls")).toHaveLength(0);
  });
  it("requires an active default-branch CI entry", async () => {
    const h = harness();
    h.state.workflow = null;
    await expect(h.execute()).rejects.toThrow("ci-default-entry-unavailable");
    expect(h.git.push).not.toHaveBeenCalled();
  });
  it.each([
    { tree: TREE, parents: [UP, MAIN] },
    { tree: TREE, parents: [MAIN] },
    { tree: "e".repeat(40), parents: [MAIN, UP] },
  ])("preserves an unexpected managed branch instead of force-updating it: %j", async (commit) => {
    const h = harness();
    h.state.ref = HEAD;
    h.git.inspect.mockReturnValue(commit);
    await expect(h.execute()).rejects.toThrow("managed-branch-needs-review");
    expect(h.git.push).not.toHaveBeenCalled();
    expect(h.writes("pulls")).toHaveLength(0);
  });
  it("stops if main advances, before generating or publishing a candidate", async () => {
    const h = harness();
    h.state.main = UP;
    await expect(h.execute()).rejects.toThrow("main-advanced-rerun-required");
    expect(h.git.plan).not.toHaveBeenCalled();
    expect(h.writes()).toHaveLength(0);
  });
  it("does not overwrite a manually edited PR body or open a duplicate", async () => {
    const h = harness();
    h.state.pulls = [pr({ body: "manually managed now" })];
    await expect(h.execute()).rejects.toThrow("unmanaged-pr-needs-review");
    expect(h.git.push).not.toHaveBeenCalled();
    expect(h.writes("pulls")).toHaveLength(0);
  });
  it("limits pagination and fails closed rather than creating a duplicate outside the scanned pages", async () => {
    const h = harness();
    h.state.pulls = Array.from({ length: 100 }, () => ({ head: { repo: { full_name: "external/repo" } } }));
    await expect(h.execute()).rejects.toThrow("github-pagination-limit");
    expect(h.git.push).not.toHaveBeenCalled();
    expect(h.writes("pulls")).toHaveLength(0);
  });
});

describe("exact-head CI and dispatch idempotency", () => {
  function ready() {
    const h = harness();
    h.state.ref = HEAD;
    h.state.pulls = [pr()];
    return h;
  }
  it("does not redispatch after a durable intent with no visible run", async () => {
    const h = ready();
    h.state.comments = [{ user: { login: BOT }, body: `<!-- homepage-upstream-ci:${HEAD} -->` }];
    await expect(h.execute()).rejects.toThrow("ci-dispatch-intent-exists-without-run");
    expect(h.writes("actions/workflows/fork-ci.yml/dispatches")).toHaveLength(0);
    expect(h.writes("issues/7/comments")).toHaveLength(0);
  });
  it("ignores a non-bot forged dispatch marker", async () => {
    const h = ready();
    h.state.comments = [{ user: { login: "someone" }, body: `<!-- homepage-upstream-ci:${HEAD} -->` }];
    await expect(h.execute()).resolves.toMatchObject({ outcome: "pr-ci-verified" });
    expect(h.writes("actions/workflows/fork-ci.yml/dispatches")).toHaveLength(1);
  });
  it("does not accept success for an old SHA and dispatches the current branch snapshot", async () => {
    const h = ready();
    h.state.run = { ...h.successRun(), head_sha: MAIN };
    await expect(h.execute()).resolves.toMatchObject({ ci: { head_sha: HEAD } });
    expect(h.writes("actions/workflows/fork-ci.yml/dispatches")).toHaveLength(1);
  });
  it.each([{ head_sha: MAIN }, { name: "unrelated check" }, { app: { id: 1, slug: "another-app" } }])(
    "rejects wrong check identity %j",
    async (override) => {
      const h = ready();
      h.state.run = h.successRun();
      Object.assign(h.state.check, override);
      await expect(h.execute()).rejects.toThrow("ci-check-identity-mismatch");
      expect(h.writes("actions/workflows/fork-ci.yml/dispatches")).toHaveLength(0);
    },
  );
  it("rejects a job check URL outside the fixed Fork without following it", async () => {
    const h = ready();
    h.state.run = h.successRun();
    h.state.job.check_run_url = "https://example.invalid/check-runs/29";
    await expect(h.execute()).rejects.toThrow("ci-check-url-invalid");
    expect(h.github.request.mock.calls.some(([, resource]) => resource.includes("example.invalid"))).toBe(false);
  });
  it("fails and notifies instead of rerunning an existing failed CI", async () => {
    const h = ready();
    h.state.run = { ...h.successRun(), conclusion: "failure" };
    h.state.job.conclusion = "failure";
    h.state.check.conclusion = "failure";
    await expect(h.execute()).rejects.toThrow("ci-failed-no-auto-rerun");
    expect(h.writes("issues")).toHaveLength(1);
    expect(h.writes("actions/workflows/fork-ci.yml/dispatches")).toHaveLength(0);
  });
  it("does not accept a success that skipped a required build step", async () => {
    const h = ready();
    h.state.run = h.successRun();
    h.state.job.steps.at(-1).conclusion = "skipped";
    await expect(h.execute()).rejects.toThrow("ci-steps-not-verified");
  });
  it("stops if the PR head changes instead of verifying the old candidate", async () => {
    const h = ready();
    h.state.ref = UP;
    await expect(
      verifyCi({ github: h.github, branch: BRANCH, head: HEAD, main: MAIN, prNumber: 7, ...h.ciOptions }),
    ).rejects.toThrow("integration-head-changed");
    expect(h.writes()).toHaveLength(0);
  });
  it("times out a pending run without reporting CI success or dispatching another", async () => {
    const h = ready();
    h.state.run = { ...h.successRun(), status: "queued", conclusion: null };
    await expect(h.execute()).rejects.toThrow("ci-observation-timeout");
    expect(h.writes("actions/workflows/fork-ci.yml/dispatches")).toHaveLength(0);
  });
  it("records notification uncertainty without masking the actual CI failure", async () => {
    const h = ready();
    h.state.run = { ...h.successRun(), conclusion: "failure" };
    h.state.job.conclusion = "failure";
    const original = h.github.request.getMockImplementation();
    h.github.request.mockImplementation((method, path, body) =>
      path === "issues" && method === "POST"
        ? Promise.reject(new Error("fixture-secret"))
        : original(method, path, body),
    );
    await expect(h.execute()).rejects.toMatchObject({ code: "ci-failed-no-auto-rerun", notification: "unconfirmed" });
  });
});

describe("real isolated Git candidate and transport tests", () => {
  function git(cwd, ...args) {
    return execFileSync(
      "git",
      ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  }
  function history() {
    const cwd = mkdtempSync(join(tmpdir(), "homepage-integrate-git-"));
    temporary.push(cwd);
    git(cwd, "init", "-b", "main");
    mkdirSync(join(cwd, ".github/workflows"), { recursive: true });
    writeFileSync(join(cwd, CI_PATH), CI);
    writeFileSync(join(cwd, "base.txt"), "base\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "base");
    const base = git(cwd, "rev-parse", "HEAD");
    writeFileSync(join(cwd, "fork.txt"), "fork\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "fork");
    const main = git(cwd, "rev-parse", "HEAD");
    git(cwd, "switch", "-c", "upstream", base);
    writeFileSync(join(cwd, "upstream.txt"), "upstream\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "upstream");
    const upstream = git(cwd, "rev-parse", "HEAD");
    git(cwd, "switch", "main");
    return { cwd, main, upstream };
  }
  it("creates a genuine two-parent merge commit with both histories and no worktree/ref changes", () => {
    const { cwd, main, upstream } = history();
    const before = git(cwd, "show-ref");
    const plan = analyzeMerge(cwd, main, upstream);
    const adapter = createGit(cwd, {}, "fixture-secret");
    const head = adapter.commit(plan.candidate_tree_sha, main, upstream);
    expect(adapter.inspect(head)).toEqual({ parents: [main, upstream], tree: plan.candidate_tree_sha });
    expect(git(cwd, "merge-base", "--is-ancestor", main, head)).toBe("");
    expect(git(cwd, "merge-base", "--is-ancestor", upstream, head)).toBe("");
    expect(git(cwd, "show", head + ":fork.txt")).toBe("fork");
    expect(git(cwd, "show", head + ":upstream.txt")).toBe("upstream");
    expect(git(cwd, "rev-parse", "HEAD")).toBe(main);
    expect(git(cwd, "show-ref")).toBe(before);
    expect(git(cwd, "status", "--porcelain")).toBe("");
  });
  it("pushes only a managed candidate to an isolated bare fixture and cannot force-update a diverged branch", () => {
    const { cwd, main, upstream } = history();
    const adapter = createGit(cwd, {}, "fixture-secret");
    const tree = analyzeMerge(cwd, main, upstream).candidate_tree_sha;
    const head = adapter.commit(tree, main, upstream);
    const bare = mkdtempSync(join(tmpdir(), "homepage-integrate-bare-"));
    temporary.push(bare);
    git(bare, "init", "--bare");
    const branch = `sync/upstream-main-${upstream}`;
    const transport = (binary, args, options) =>
      spawnSync(
        binary,
        args.map((arg) => (arg === `https://github.com/${FORK}.git` ? bare : arg)),
        options,
      );
    pushCandidate(cwd, head, branch, "fixture-secret", transport);
    expect(git(bare, "rev-parse", `refs/heads/${branch}`)).toBe(head);
    writeFileSync(join(cwd, "human.txt"), "human work\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "human branch");
    const human = git(cwd, "rev-parse", "HEAD");
    git(cwd, "push", bare, `${human}:refs/heads/human-seed`);
    git(bare, "update-ref", `refs/heads/${branch}`, human);
    expect(() => pushCandidate(cwd, head, branch, "fixture-secret", transport)).toThrow("git-push-unconfirmed");
    expect(git(bare, "rev-parse", `refs/heads/${branch}`)).toBe(human);
  });
});
