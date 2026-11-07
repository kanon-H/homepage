import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  FORK,
  GIT_OPTIONS,
  gitCommand,
  gitEnvironment,
  runPreflight,
  validateContext,
} from "./fork-upstream-preflight.mjs";

export const CI_PATH = ".github/workflows/fork-ci.yml";
export const CI_DIGEST = "5dc57244b35a2e5026358cc0010185bd83d3c222ec24c474ff3c232f3aa23bcb";
const FORK_URL = `https://github.com/${FORK}.git`;
const BRANCH = /^sync\/upstream-main-([0-9a-f]{40})$/;
const SHA = /^[0-9a-f]{40}$/;
const BOT = "github-actions[bot]";

export class SyncError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function requireValue(condition, code) {
  if (!condition) throw new SyncError(code);
}

function commitSha(value) {
  requireValue(typeof value === "string" && SHA.test(value), "invalid-commit-sha");
  return value;
}

function branchName(upstream) {
  return `sync/upstream-main-${commitSha(upstream)}`;
}

function errorCode(error) {
  return error?.code && /^[a-z0-9-]{1,80}$/.test(error.code) ? error.code : "sync-failed";
}

export function validateWriteContext(env) {
  const context = validateContext(env);
  requireValue(
    env.SYNC_WRITE_APPROVED === "true" &&
      env.GITHUB_WORKFLOW_REF === `${FORK}/.github/workflows/fork-upstream-integrate.yml@refs/heads/main`,
    "write-workflow-not-approved",
  );
  requireValue(typeof env.GITHUB_RUN_ID === "string" && /^[0-9]+$/.test(env.GITHUB_RUN_ID), "invalid-run-id");
  return { ...context, runUrl: `https://github.com/${FORK}/actions/runs/${env.GITHUB_RUN_ID}` };
}

// Token stays in memory. Only these writes are implemented; no merge, settings,
// main-ref updates, PR approval, deletion, package login or release endpoints.
export function createGithub(token, fetcher = globalThis.fetch) {
  requireValue(typeof token === "string" && token.length > 0, "sync-token-required");
  async function request(method, resource, body) {
    requireValue(
      typeof resource === "string" && !resource.includes("..") && !resource.startsWith("/") && !resource.includes(":"),
      "invalid-api-resource",
    );
    if (method !== "GET") {
      const allowed =
        method === "POST" &&
        ((resource === "pulls" &&
          body?.base === "main" &&
          BRANCH.test(body?.head?.replace("kanon-H:", "") ?? "") &&
          body?.draft === true) ||
          (resource === "issues" && /^<!-- homepage-upstream-failure:[0-9a-f]{40} -->/.test(body?.body ?? "")) ||
          (/^issues\/[0-9]+\/comments$/.test(resource) &&
            /^<!-- homepage-upstream-ci:[0-9a-f]{40} -->/.test(body?.body ?? "")) ||
          (resource === "actions/workflows/fork-ci.yml/dispatches" && BRANCH.test(body?.ref ?? "")));
      requireValue(allowed, "api-write-not-allowed");
    }
    let response;
    try {
      response = await fetcher(`https://api.github.com/repos/${FORK}${resource ? "/" + resource : ""}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new SyncError(`github-${method.toLowerCase()}-unconfirmed`);
    }
    if (method === "GET" && response.status === 404) return null;
    requireValue(response.ok, `github-${method.toLowerCase()}-${response.status}`);
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new SyncError("github-response-invalid");
    }
  }
  return { request };
}

async function list(github, resource) {
  const items = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await github.request(
      "GET",
      `${resource}${resource.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    requireValue(Array.isArray(batch), "github-list-invalid");
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw new SyncError("github-pagination-limit");
}

export function pushCandidate(cwd, head, branch, token, spawn = spawnSync) {
  commitSha(head);
  requireValue(BRANCH.test(branch) && typeof token === "string" && token.length > 0, "invalid-push-target");
  const env = {
    ...gitEnvironment(),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `http.${FORK_URL}.extraHeader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
  };
  const result = spawn(
    "git",
    [...GIT_OPTIONS, "push", "--porcelain", "--no-verify", "--no-force", FORK_URL, `${head}:refs/heads/${branch}`],
    { cwd, env, encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 },
  );
  requireValue(!result.error && result.status === 0, "git-push-unconfirmed");
}

export function createGit(cwd, env, token) {
  return {
    plan: () => runPreflight(env),
    file: (revision) => gitCommand(cwd, ["show", `${commitSha(revision)}:${CI_PATH}`]).output,
    fetch: (head) =>
      gitCommand(cwd, [
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        "--no-recurse-submodules",
        "--refmap=",
        "--no-auto-maintenance",
        FORK_URL,
        commitSha(head),
      ]),
    inspect: (head) => {
      const [parents, tree] = gitCommand(cwd, ["show", "--format=%P%n%T", "--no-patch", commitSha(head)])
        .output.trimEnd()
        .split("\n");
      return { parents: parents.split(" ").filter(Boolean), tree };
    },
    commit: (tree, main, upstream) =>
      commitSha(
        gitCommand(cwd, [
          "-c",
          `user.name=${BOT}`,
          "-c",
          "user.email=41898282+github-actions[bot]@users.noreply.github.com",
          "-c",
          "commit.gpgSign=false",
          "commit-tree",
          commitSha(tree),
          "-p",
          commitSha(main),
          "-p",
          commitSha(upstream),
          "-m",
          `Merge upstream main ${upstream}\n\nFork base: ${main}`,
        ]).output.trim(),
      ),
    push: (head, branch) => pushCandidate(cwd, head, branch, token),
  };
}

async function assertMain(github, main) {
  const ref = await github.request("GET", "git/ref/heads/main");
  requireValue(ref?.object?.sha === main, "main-advanced-rerun-required");
}

function assertPr(pr, branch, head) {
  requireValue(
    pr?.head?.repo?.full_name === FORK &&
      pr?.base?.repo?.full_name === FORK &&
      pr?.head?.ref === branch &&
      pr?.head?.sha === head &&
      pr?.base?.ref === "main" &&
      !pr?.merged &&
      pr?.auto_merge === null &&
      Number.isSafeInteger(pr?.number),
    "pr-identity-changed",
  );
}

async function assertHead(github, branch, head, prNumber) {
  const ref = await github.request("GET", `git/ref/heads/${branch}`);
  requireValue(ref?.object?.sha === head, "integration-head-changed");
  if (prNumber) {
    const pr = await github.request("GET", `pulls/${prNumber}`);
    assertPr(pr, branch, head);
    requireValue(pr.state === "open", "integration-pr-closed");
  }
}

export async function notifyFailure(github, upstream, main, code, runUrl, details = {}) {
  const marker = `<!-- homepage-upstream-failure:${commitSha(upstream)} -->`;
  const issues = await list(github, "issues?state=all");
  const existing = issues.find(
    (issue) => !issue.pull_request && issue.user?.login === BOT && issue.body?.startsWith(marker),
  );
  if (existing) return existing.number;
  const result = await github.request("POST", "issues", {
    title: `Upstream main sync requires review (${upstream.slice(0, 12)})`,
    body: `${marker}\n\nSync stopped: ${code}.\n\nFork base: ${main}\nUpstream main: ${upstream}\nRun: ${runUrl}\n\nDiagnostic data (paths may be truncated):\n\`\`\`json\n${JSON.stringify(details, null, 2)}\n\`\`\`\n\nNo automatic main merge or deployment. Inspect the branch/PR and CI before retrying.`,
  });
  requireValue(Number.isSafeInteger(result?.number), "issue-response-invalid");
  return result.number;
}

export async function verifyCi({
  github,
  branch,
  head,
  prNumber,
  main,
  wait = (ms) => new Promise((done) => setTimeout(done, ms)),
  now = Date.now,
  timeoutMs = 25 * 60_000,
}) {
  const marker = `<!-- homepage-upstream-ci:${head} -->`;
  const resource = `actions/workflows/fork-ci.yml/runs?event=workflow_dispatch&branch=${encodeURIComponent(branch)}&per_page=100`;
  const deadline = now() + timeoutMs;
  let dispatched = false;
  while (now() < deadline) {
    await assertMain(github, main);
    await assertHead(github, branch, head, prNumber);
    const page = await github.request("GET", resource);
    requireValue(Array.isArray(page?.workflow_runs), "ci-list-invalid");
    const runs = page.workflow_runs.filter(
      (run) =>
        run.head_sha === head &&
        run.head_repository?.full_name === FORK &&
        run.path === CI_PATH &&
        run.event === "workflow_dispatch" &&
        run.head_branch === branch,
    );
    const run = runs.sort((a, b) => b.id - a.id)[0];
    if (run) {
      requireValue(Number.isSafeInteger(run.id), "ci-run-invalid");
      if (run.status === "completed") {
        const response = await github.request("GET", `actions/runs/${run.id}/jobs?per_page=100`);
        const jobs = response?.jobs?.filter((job) => job.name === "Fork verification");
        requireValue(jobs?.length === 1, "ci-job-missing");
        const job = jobs[0];
        requireValue(
          job.head_sha === head && job.status === "completed" && Number.isSafeInteger(job.id),
          "ci-job-sha-mismatch",
        );
        const prefix = `https://api.github.com/repos/${FORK}/check-runs/`;
        const checkId =
          typeof job.check_run_url === "string" && job.check_run_url.startsWith(prefix)
            ? job.check_run_url.slice(prefix.length)
            : "";
        requireValue(
          /^[0-9]+$/.test(checkId) && Number.isSafeInteger(Number(checkId)) && Number(checkId) > 0,
          "ci-check-url-invalid",
        );
        const check = await github.request("GET", `check-runs/${checkId}`);
        requireValue(
          check?.id === Number(checkId) &&
            check?.name === "Fork verification" &&
            check.head_sha === head &&
            check.app?.id === 15368 &&
            check.app?.slug === "github-actions",
          "ci-check-identity-mismatch",
        );
        requireValue(
          run.conclusion === "success" &&
            job.conclusion === "success" &&
            check.status === "completed" &&
            check.conclusion === "success",
          "ci-failed-no-auto-rerun",
        );
        const required = [
          "Verify tool versions and source",
          "Install frozen dependencies",
          "Lint",
          "Test",
          "Build with isolated fictional configuration",
        ];
        requireValue(
          required.every((name) =>
            job.steps?.some(
              (step) => step.name === name && step.status === "completed" && step.conclusion === "success",
            ),
          ),
          "ci-steps-not-verified",
        );
        return { run_id: run.id, job_id: job.id, check_run_id: Number(checkId), head_sha: head, conclusion: "success" };
      }
    } else if (!dispatched) {
      const comments = await list(github, `issues/${prNumber}/comments`);
      requireValue(
        !comments.some((comment) => comment.user?.login === BOT && comment.body?.startsWith(marker)),
        "ci-dispatch-intent-exists-without-run",
      );
      // Durable at-most-once intent: ambiguous POST failures never cause blind redispatch.
      const intent = await github.request("POST", `issues/${prNumber}/comments`, {
        body: `${marker}\n\nRequesting Fork CI for exact head ${head}. A missing run requires operator inspection, not blind redispatch.`,
      });
      requireValue(intent?.user?.login === BOT, "ci-intent-author-unexpected");
      await github.request("POST", "actions/workflows/fork-ci.yml/dispatches", { ref: branch });
      dispatched = true;
    }
    await wait(15_000);
  }
  throw new SyncError("ci-observation-timeout");
}

function prBody(main, upstream, runUrl) {
  return `<!-- homepage-upstream-pr:${upstream} -->\n\n## Proposed change\n\nMerge official gethomepage/homepage **main** into this personal Fork using a two-parent merge commit.\n\nFork base: ${main}\nUpstream: ${upstream}\nSync run: ${runUrl}\n\nThis is AI-assisted automation for kanon-H/homepage, not an upstream contribution. Draft only: no auto-merge, release or deployment.\n\n## Type of change\n\n- [x] Other: upstream integration\n\n## Checklist:\n\n- [ ] Review authentication, dependencies, extension field collisions and upstream native multi-address support.\n- [ ] Verify exact-head Fork CI, P5 applicability and runtime compatibility before manually merging.\n- [x] Preserve upstream and Fork ancestry; no squash or force push.\n`;
}

export async function runSync({ github, git, main, runUrl, ciOptions = {} }) {
  commitSha(main);
  requireValue(
    typeof runUrl === "string" && /^https:\/\/github\.com\/kanon-H\/homepage\/actions\/runs\/[0-9]+$/.test(runUrl),
    "invalid-run-url",
  );
  let upstream;
  const details = {};
  try {
    const repo = await github.request("GET", "");
    requireValue(
      repo?.full_name === FORK && repo.fork && repo.default_branch === "main" && repo.private === false,
      "fork-identity-required",
    );
    await assertMain(github, main);
    const plan = await git.plan();
    requireValue(plan.main_sha === main, "plan-main-mismatch");
    upstream = commitSha(plan.upstream_sha);
    if (plan.outcome === "up-to-date") return { outcome: "up-to-date", main_sha: main, upstream_sha: upstream };
    if (plan.outcome !== "clean-merge") {
      details.conflicts = Array.isArray(plan.conflicts)
        ? plan.conflicts.slice(0, 50).map((path) => String(path).slice(0, 512))
        : [];
      throw new SyncError(plan.outcome === "conflict" ? "merge-conflict" : "merge-not-safe");
    }
    const tree = commitSha(plan.candidate_tree_sha);
    const branch = branchName(upstream);
    const pulls = await list(github, "pulls?state=all&base=main");
    const sameHead = pulls.filter((pr) => pr.head?.repo?.full_name === FORK && pr.head?.ref === branch);
    requireValue(
      sameHead.every((pr) => pr.body?.startsWith(`<!-- homepage-upstream-pr:${upstream} -->`)),
      "unmanaged-pr-needs-review",
    );
    const managed = pulls.filter(
      (pr) =>
        pr.head?.repo?.full_name === FORK &&
        pr.base?.repo?.full_name === FORK &&
        BRANCH.test(pr.head?.ref ?? "") &&
        pr.body?.startsWith(`<!-- homepage-upstream-pr:${BRANCH.exec(pr.head.ref)[1]} -->`),
    );
    const same = managed.filter((pr) => pr.head.ref === branch);
    requireValue(same.length <= 1, "multiple-managed-prs");
    if (same[0]?.state === "closed") {
      requireValue(!same[0].merged_at, "merged-upstream-not-in-main");
      return { outcome: "declined", pr_number: same[0].number, upstream_sha: upstream };
    }
    if (managed.some((pr) => pr.state === "open" && pr.head.ref !== branch))
      return { outcome: "pending-other-upstream-pr" };
    const trustedCi = await git.file(main);
    requireValue(
      createHash("sha256").update(trustedCi).digest("hex") === CI_DIGEST && (await git.file(tree)) === trustedCi,
      "ci-definition-review-required",
    );
    const workflow = await github.request("GET", "actions/workflows/fork-ci.yml");
    requireValue(workflow?.path === CI_PATH && workflow.state === "active", "ci-default-entry-unavailable");
    let ref = await github.request("GET", `git/ref/heads/${branch}`);
    let head;
    if (ref) {
      head = commitSha(ref.object?.sha);
      await git.fetch(head);
    } else {
      requireValue(!same.length, "open-pr-branch-missing");
      head = commitSha(await git.commit(tree, main, upstream));
    }
    const commit = await git.inspect(head);
    requireValue(
      commit.tree === tree &&
        commit.parents?.length === 2 &&
        commit.parents[0] === main &&
        commit.parents[1] === upstream,
      "managed-branch-needs-review",
    );
    await assertMain(github, main);
    if (!ref) {
      await git.push(head, branch);
      ref = await github.request("GET", `git/ref/heads/${branch}`);
      requireValue(ref?.object?.sha === head, "published-head-unconfirmed");
    }
    await assertMain(github, main);
    await assertHead(github, branch, head, same[0]?.number);
    let pr = same[0];
    if (!pr)
      pr = await github.request("POST", "pulls", {
        title: `chore: merge upstream main ${upstream.slice(0, 12)}`,
        head: `kanon-H:${branch}`,
        base: "main",
        draft: true,
        maintainer_can_modify: false,
        body: prBody(main, upstream, runUrl),
      });
    assertPr(pr, branch, head);
    requireValue(pr.state === "open", "integration-pr-not-open");
    details.pr_number = pr.number;
    details.candidate_head = head;
    const ci = await verifyCi({ ...ciOptions, github, main, branch, head, prNumber: pr.number });
    await assertMain(github, main);
    await assertHead(github, branch, head, pr.number);
    return { outcome: "pr-ci-verified", branch, pr_number: pr.number, main_sha: main, upstream_sha: upstream, ci };
  } catch (error) {
    const failure = error instanceof SyncError ? error : new SyncError(errorCode(error));
    if (upstream) {
      try {
        failure.issueNumber = await notifyFailure(github, upstream, main, failure.code, runUrl, details);
      } catch {
        failure.notification = "unconfirmed";
      }
    }
    throw failure;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const context = validateWriteContext(process.env);
    const token = process.env.SYNC_TOKEN;
    const github = createGithub(token);
    const result = await runSync({
      github,
      git: createGit(context.cwd, process.env, token),
      main: context.mainSha,
      runUrl: context.runUrl,
    });
    const output = JSON.stringify(result, null, 2);
    process.stdout.write(output + "\n");
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `## Upstream integration\n\n\`\`\`json\n${output}\n\`\`\`\n\nNo automatic main merge, release or deployment.\n`,
      );
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        outcome: "error",
        code: errorCode(error),
        issue_number: error?.issueNumber,
        notification: error?.notification,
      }) + "\n",
    );
    process.exitCode = 1;
  }
}
