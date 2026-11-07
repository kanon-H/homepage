import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { load } from "js-yaml";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  analyzeMerge,
  fetchUpstreamMain,
  gitCommand,
  parseUpstreamRef,
  preflightExitCode,
  runPreflight,
  UPSTREAM,
  validateContext,
} from "../../../scripts/fork-upstream-preflight.mjs";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const temporary = [];
const sha = "a".repeat(40);
const context = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "kanon-H/homepage",
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_WORKSPACE: root,
  EXPECTED_MAIN_SHA: sha,
};

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function git(cwd, ...args) {
  return execFileSync(
    "git",
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    },
  ).trim();
}

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "homepage-sync-git-"));
  temporary.push(cwd);
  git(cwd, "init", "-b", "main");
  writeFileSync(join(cwd, "shared.txt"), "base\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "base");
  return { cwd, base: git(cwd, "rev-parse", "HEAD") };
}

function commit(cwd, path, contents) {
  writeFileSync(join(cwd, path), contents);
  git(cwd, "add", "--", path);
  git(cwd, "commit", "-m", "fixture change");
  return git(cwd, "rev-parse", "HEAD");
}

function snapshot(cwd) {
  return {
    head: git(cwd, "rev-parse", "HEAD"),
    refs: git(cwd, "show-ref"),
    status: git(cwd, "status", "--porcelain"),
    index: readFileSync(join(cwd, ".git/index")).toString("base64"),
    files: readdirSync(cwd).sort(),
    shared: readFileSync(join(cwd, "shared.txt"), "utf8"),
  };
}

describe("trusted read-only upstream workflow", () => {
  it("only schedules or dispatches on this Fork main with read permissions and pinned actions", () => {
    const workflow = load(readFileSync(join(root, ".github/workflows/fork-upstream-sync.yml"), "utf8"));
    expect(Object.keys(workflow.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
    expect(workflow.on.schedule).toEqual([{ cron: "17 4 * * 1" }]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    const job = workflow.jobs.preflight;
    expect(job.if).toBe("github.repository == 'kanon-H/homepage' && github.ref == 'refs/heads/main'");
    expect(job.steps[0].with).toEqual({ ref: "${{ github.sha }}", "fetch-depth": 0, "persist-credentials": false });
    expect(job.steps[1].with).toEqual({ "node-version": "24.22.1" });
    expect(job.steps.at(-1).env.EXPECTED_MAIN_SHA).toBe("${{ github.sha }}");
    expect(job.steps.at(-1).run).toBe("node scripts/fork-upstream-preflight.mjs");
    for (const step of job.steps.filter((step) => step.uses)) expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
    expect(JSON.stringify(workflow)).not.toMatch(
      /secrets\.|packages|pull_request_target|workflow_run|write|continue-on-error/,
    );
  });

  it.each([
    ["up-to-date", 0],
    ["clean-merge", 0],
    ["conflict", 1],
    ["unrelated-histories", 1],
    ["unknown", 1],
  ])("maps %s to fail-closed exit %i", (outcome, code) => {
    expect(preflightExitCode({ outcome })).toBe(code);
  });

  it("exits the CLI before Git/network work in an untrusted context without printing credentials", () => {
    const result = spawnSync(process.execPath, [join(root, "scripts/fork-upstream-preflight.mjs")], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, GITHUB_ACTIONS: "false", GITHUB_TOKEN: "fixture-token-must-not-print" },
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ outcome: "error", code: "trusted-main-workflow-required" });
    expect(result.stdout + result.stderr).not.toContain("fixture-token-must-not-print");
  });

  it("accepts the trusted main snapshot", () => {
    expect(validateContext(context)).toEqual({ cwd: root, mainSha: sha });
    expect(validateContext({ ...context, GITHUB_EVENT_NAME: "schedule" }).mainSha).toBe(sha);
  });

  it.each([
    { GITHUB_ACTIONS: "false" },
    { GITHUB_REPOSITORY: "gethomepage/homepage" },
    { GITHUB_REF: "refs/heads/feature/test" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_EVENT_NAME: "pull_request_target" },
    { GITHUB_WORKSPACE: "" },
    { EXPECTED_MAIN_SHA: "main" },
  ])("rejects an untrusted context %j before Git/network work", (override) => {
    const run = vi.fn();
    expect(() => runPreflight({ ...context, ...override }, run)).toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["main", "-" + sha, "A".repeat(40), "a".repeat(39), "a".repeat(41), sha + "\n"])(
    "rejects a non-exact SHA %j",
    (input) => {
      expect(() => analyzeMerge(root, input, sha, vi.fn())).toThrow("invalid-commit-sha");
    },
  );

  it("rejects an unexpected origin without fetching", () => {
    const run = vi.fn((_cwd, args) => ({
      status: 0,
      output: args[0] === "remote" ? UPSTREAM : args[1] === "HEAD" ? sha : root,
    }));
    expect(() => runPreflight(context, run)).toThrow("fork-origin-required");
    expect(run.mock.calls.some(([, args]) => args[0] === "fetch")).toBe(false);
  });

  it("runs the trusted snapshot through explicit upstream main only", () => {
    const run = vi.fn((_cwd, args) => {
      if (args[0] === "config") return { status: 1, output: "" };
      if (args[0] === "remote") return { status: 0, output: "https://github.com/kanon-H/homepage.git" };
      if (args[0] === "ls-remote") return { status: 0, output: sha + "\trefs/heads/main\n" };
      if (args[0] === "cat-file") return { status: 0, output: "commit\n" };
      return { status: 0, output: args[1] === "--show-toplevel" ? root : sha };
    });
    expect(runPreflight(context, run)).toMatchObject({ outcome: "up-to-date", main_sha: sha, upstream_sha: sha });
    expect(
      run.mock.calls.some(([, args]) => ["push", "checkout", "switch", "update-ref", "commit"].includes(args[0])),
    ).toBe(false);
  });

  it("does not accept dev, HEAD or extra ls-remote output", () => {
    expect(parseUpstreamRef(sha + "\trefs/heads/main\n")).toBe(sha);
    for (const input of [sha + "\trefs/heads/dev\n", sha + "\tHEAD", sha + "\trefs/heads/main\nextra", "not a SHA"]) {
      expect(() => parseUpstreamRef(input)).toThrow("invalid-upstream-main-ref");
    }
  });

  it("fetches only the observed official main objects without tags, FETCH_HEAD or a destination ref", () => {
    const run = vi.fn((_cwd, args) =>
      args[0] === "config" ? { status: 1, output: "" } : { status: 0, output: sha + "\trefs/heads/main\n" },
    );
    expect(fetchUpstreamMain(root, run)).toBe(sha);
    expect(run.mock.calls[1][1]).toEqual(["ls-remote", "--exit-code", "--heads", UPSTREAM, "refs/heads/main"]);
    expect(run.mock.calls[2][1]).toEqual([
      "fetch",
      "--no-tags",
      "--no-write-fetch-head",
      "--no-recurse-submodules",
      "--refmap=",
      "--no-auto-maintenance",
      UPSTREAM,
      sha,
    ]);
  });

  it("rejects a mismatched checkout before fetching", () => {
    const run = vi.fn((_cwd, args) => ({ status: 0, output: args[1] === "--show-toplevel" ? root : "b".repeat(40) }));
    expect(() => runPreflight(context, run)).toThrow("checkout-snapshot-mismatch");
    expect(run.mock.calls.some(([, args]) => args[0] === "fetch")).toBe(false);
  });
});

describe("real Git merge-tree, synthetic histories only", () => {
  it("fetches real fixture objects without changing refs, tags, index or FETCH_HEAD", () => {
    const upstream = fixture();
    const head = commit(upstream.cwd, "new.txt", "new upstream\n");
    git(upstream.cwd, "tag", "upstream-only");
    const target = fixture();
    git(target.cwd, "remote", "add", "upstream", upstream.cwd);
    git(target.cwd, "update-ref", "refs/remotes/upstream/main", target.base);
    writeFileSync(join(target.cwd, ".git/FETCH_HEAD"), "keep this metadata\n");
    const before = snapshot(target.cwd);
    const adapter = (cwd, args, accepted) =>
      gitCommand(
        cwd,
        args.map((arg) => (arg === UPSTREAM ? upstream.cwd : arg)),
        accepted,
      );
    expect(fetchUpstreamMain(target.cwd, adapter)).toBe(head);
    expect(git(target.cwd, "cat-file", "-t", head)).toBe("commit");
    expect(snapshot(target.cwd)).toEqual(before);
    expect(git(target.cwd, "tag", "--list")).toBe("");
    expect(readFileSync(join(target.cwd, ".git/FETCH_HEAD"), "utf8")).toBe("keep this metadata\n");
  });

  it("rejects local URL rewrites before contacting an alternative endpoint", () => {
    const { cwd } = fixture();
    git(cwd, "config", "url.https://example.invalid/.insteadOf", "https://github.com/");
    expect(() => fetchUpstreamMain(cwd)).toThrow("custom-git-config-not-supported");
  });

  it("rejects a non-commit object", () => {
    const { cwd, base } = fixture();
    const blob = git(cwd, "hash-object", "-w", "shared.txt");
    expect(() => analyzeMerge(cwd, base, blob)).toThrow("object-is-not-commit");
  });
  it("reports no update when upstream is already an ancestor without changing refs/index/worktree", () => {
    const { cwd, base } = fixture();
    const main = commit(cwd, "fork.txt", "fork\n");
    const before = snapshot(cwd);
    expect(analyzeMerge(cwd, main, base)).toMatchObject({
      outcome: "up-to-date",
      candidate_tree_sha: null,
      conflicts: [],
    });
    expect(snapshot(cwd)).toEqual(before);
  });

  it("preserves both sides of a divergent merge in a tree, not a source commit", () => {
    const { cwd, base } = fixture();
    const main = commit(cwd, "fork.txt", "fork\n");
    git(cwd, "switch", "-c", "upstream", base);
    const upstream = commit(cwd, "upstream.txt", "upstream\n");
    git(cwd, "switch", "main");
    // A dirty operator file and existing FETCH_HEAD must also survive.
    writeFileSync(join(cwd, "shared.txt"), "uncommitted operator work\n");
    writeFileSync(join(cwd, ".git/FETCH_HEAD"), "existing fetch metadata\n");
    const before = snapshot(cwd);
    const result = analyzeMerge(cwd, main, upstream);
    expect(result.outcome).toBe("clean-merge");
    expect(git(cwd, "cat-file", "-t", result.candidate_tree_sha)).toBe("tree");
    expect(git(cwd, "show", result.candidate_tree_sha + ":fork.txt")).toBe("fork");
    expect(git(cwd, "show", result.candidate_tree_sha + ":upstream.txt")).toBe("upstream");
    expect(snapshot(cwd)).toEqual(before);
    expect(readFileSync(join(cwd, ".git/FETCH_HEAD"), "utf8")).toBe("existing fetch metadata\n");
  });

  it("reports a conflict without publishing a conflicted tree or modifying files", () => {
    const { cwd, base } = fixture();
    const main = commit(cwd, "shared.txt", "fork\n");
    git(cwd, "switch", "-c", "upstream", base);
    const upstream = commit(cwd, "shared.txt", "upstream\n");
    git(cwd, "switch", "main");
    const before = snapshot(cwd);
    expect(analyzeMerge(cwd, main, upstream)).toMatchObject({
      outcome: "conflict",
      candidate_tree_sha: null,
      conflicts: ["shared.txt"],
    });
    expect(snapshot(cwd)).toEqual(before);
    expect(existsSync(join(cwd, ".git/MERGE_HEAD"))).toBe(false);
  });

  it("refuses unrelated histories rather than allowing an unrelated merge", () => {
    const { cwd, base } = fixture();
    git(cwd, "switch", "--orphan", "unrelated");
    const upstream = commit(cwd, "other.txt", "other\n");
    expect(analyzeMerge(cwd, base, upstream).outcome).toBe("unrelated-histories");
  });

  it("does not execute hooks and refuses custom merge drivers", () => {
    const { cwd, base } = fixture();
    const upstream = commit(cwd, "upstream.txt", "new\n");
    const marker = join(cwd, "hook-ran");
    writeFileSync(join(cwd, ".git/hooks/pre-merge-commit"), `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o700 });
    expect(analyzeMerge(cwd, base, upstream).outcome).toBe("clean-merge");
    expect(existsSync(marker)).toBe(false);
    git(cwd, "config", "merge.unsafe.driver", "touch " + marker);
    expect(() => analyzeMerge(cwd, base, upstream)).toThrow("custom-git-config-not-supported");
    expect(existsSync(marker)).toBe(false);
  });

  it("fails closed on invalid objects without returning command stderr", () => {
    const { cwd, base } = fixture();
    expect(() => analyzeMerge(cwd, base, "0".repeat(40))).toThrow("git-operation-failed");
    expect(() => gitCommand(cwd, ["not-a-command"])).toThrow("git-operation-failed");
  });
});
