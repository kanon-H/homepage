import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { load } from "js-yaml";
import { afterEach, describe, expect, it, vi } from "vitest";

import { allowedContextPath, createImageContext } from "../../../scripts/fork-image-context.mjs";
import {
  fileDigest,
  imageName,
  inspectArchive,
  publishArchive,
  registryManifest,
  registryToken,
  runTool,
  withRegistryAuth,
} from "../../../scripts/fork-image-publish.mjs";
import { smokeArchive } from "../../../scripts/fork-image-smoke.mjs";
import {
  githubGet,
  isSha,
  isVersion,
  prepareRelease,
  RELEASE_FILES,
  releaseContext,
  REPOSITORY,
  verifyReleaseEnvironment,
  verifyReleaseSource,
} from "../../../scripts/fork-release.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const workflow = load(readFileSync(join(root, ".github/workflows/fork-release.yml"), "utf8"));
const tagWorkflow = load(readFileSync(join(root, ".github/workflows/fork-release-tag.yml"), "utf8"));
const directories = [];
const sha = "a".repeat(40);
const upstream = "b".repeat(40);
const plan = { version: "fork-v0.1.0", source_sha: sha, upstream_sha: upstream, created: "2026-11-08T00:00:00.000Z" };
const env = {
  GITHUB_REPOSITORY: REPOSITORY,
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/fork-release.yml@refs/heads/main`,
  GITHUB_SHA: sha,
  GITHUB_RUN_ATTEMPT: "1",
  RELEASE_PUBLISH: "false",
  RELEASE_VERSION: "",
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function temporary() {
  const directory = mkdtempSync(join(tmpdir(), "homepage-release-test-"));
  directories.push(directory);
  return directory;
}
function git(directory, ...args) {
  const result = spawnSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    },
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}
function put(directory, file, value = "fixture\n") {
  mkdirSync(dirname(join(directory, file)), { recursive: true });
  writeFileSync(join(directory, file), value);
}
function repository() {
  const directory = temporary();
  git(directory, "init", "-b", "main");
  git(directory, "remote", "add", "origin", `https://github.com/${REPOSITORY}.git`);
  for (const file of RELEASE_FILES) put(directory, file);
  for (const file of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "next.config.js",
    "next-i18next.config.js",
    "jsconfig.json",
    "postcss.config.js",
    "tailwind.config.js",
    "docker-entrypoint.sh",
    "LICENSE",
  ])
    put(directory, file);
  put(directory, "src/app.js");
  put(directory, "public/binary.png", Buffer.from([0, 255, 127, 200]));
  git(directory, "add", ".");
  git(directory, "commit", "-m", "fixture base");
  const base = git(directory, "rev-parse", "HEAD");
  git(directory, "tag", "fork-v0.1.0");
  put(directory, "ordinary.txt");
  git(directory, "add", ".");
  git(directory, "commit", "-m", "fixture main");
  const main = git(directory, "rev-parse", "HEAD");
  const context = { ...env, GITHUB_SHA: main, RELEASE_VERSION: "fork-v0.1.0" };
  const get = vi.fn(async (path) =>
    path.endsWith("/branches/main") ? { commit: { sha: main } } : { object: { type: "commit", sha: base } },
  );
  return { directory, main, base, context, get };
}

describe("Fork release workflow boundaries", () => {
  it("keeps registry publication in a main-only manual controller with explicit opt-in", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch.inputs.publish).toMatchObject({ type: "boolean", default: false });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.plan.if).toContain("github.ref == 'refs/heads/main'");
    expect(workflow.jobs.plan.steps.at(-1).env.RELEASE_ENABLED).toBe("${{ vars.DOCKERHUB_RELEASE_ENABLED }}");
    expect(workflow.concurrency).toEqual({ group: "fork-dockerhub-release", "cancel-in-progress": false });
    expect(workflow.jobs.publish.environment).toBe("dockerhub-release");
    expect(workflow.jobs.publish.needs).toEqual(["plan", "build"]);
    expect(workflow.jobs.publish.if).toBe("needs.plan.outputs.publish == 'true'");
  });
  it("has no registry secrets in planning or candidate build, and never rebuilds in the publisher", () => {
    expect(JSON.stringify([workflow.jobs.plan, workflow.jobs.build])).not.toMatch(
      /secrets\.|login-action|packages:|id-token/,
    );
    expect(JSON.stringify(workflow.jobs.publish)).not.toMatch(/pnpm|build-push-action|npm install/);
    expect(workflow.jobs.publish.steps[0].with).toMatchObject({
      ref: "${{ github.sha }}",
      "persist-credentials": false,
    });
    const builder = workflow.jobs.build.steps.find((s) => s.uses?.startsWith("docker/build-push-action@"));
    expect(builder.with).toMatchObject({
      push: false,
      platforms: "linux/amd64,linux/arm64",
      provenance: false,
      sbom: false,
      context: "${{ runner.temp }}/fork-release/context",
    });
    const names = workflow.jobs.build.steps.map((s) => s.name);
    expect(names.indexOf("Export allowlisted committed build context")).toBeLessThan(
      names.indexOf("Install frozen dependencies"),
    );
    expect(names.indexOf("Verify both platform structures and HTTP auth Host mounts identity health")).toBeLessThan(
      names.indexOf("Upload only the tested OCI archive"),
    );
    expect(
      workflow.jobs.publish.steps.find((s) => s.uses?.startsWith("actions/download-artifact@")).with["artifact-ids"],
    ).toBe("${{ needs.build.outputs.artifact_id }}");
  });
  it("only uses pinned actions, no caches, no continue-on-error and no default latest", () => {
    for (const w of [workflow, tagWorkflow])
      for (const job of Object.values(w.jobs))
        for (const step of job.steps) {
          if (step.uses) expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
          expect(step["continue-on-error"]).toBeUndefined();
        }
    expect(JSON.stringify(workflow)).not.toMatch(/latest|cache-from|cache-to|pull_request_target/);
    expect(workflow.jobs.build.steps.find((s) => s.name === "Install frozen dependencies").run).toBe(
      "pnpm install --frozen-lockfile",
    );
  });
  it("only notifies main from fork tags, without checkout or registry secrets and without POST retries", () => {
    expect(tagWorkflow.on.push.tags).toEqual(["fork-v*"]);
    expect(tagWorkflow.permissions).toEqual({});
    expect(tagWorkflow.jobs.notify.permissions).toEqual({ contents: "read", actions: "write" });
    expect(JSON.stringify(tagWorkflow)).not.toMatch(/secrets\.|checkout@|login-action/);
    const step = tagWorkflow.jobs.notify.steps[0];
    expect(step.with.retries).toBe(0);
    expect(step.with.script).toContain("workflow_id: 'fork-release.yml', ref: 'main'");
    expect(step.env.RELEASE_TAG).toBe("${{ github.ref_name }}");
  });
  it("uses a separate same-libc pinned multiarch Dockerfile, GPL license and no host prebuilt artifacts", () => {
    const text = readFileSync(join(root, "Dockerfile.fork"), "utf8");
    expect(text).toMatch(/node:24\.22\.1-alpine@sha256:[a-f0-9]{64}/);
    expect(text.match(/FROM \$\{NODE_IMAGE\}/g)).toHaveLength(2);
    expect(text).toContain("pnpm@10.34.9");
    expect(text).toContain("pnpm install --frozen-lockfile");
    expect(text).toContain('org.opencontainers.image.licenses="GPL-3.0-only"');
    expect(text).toContain("COPY LICENSE /usr/share/doc/homepage/LICENSE");
    expect(text).not.toMatch(/ARG CI|pnpm@latest|DOCKERHUB_TOKEN/);
    const ignore = readFileSync(join(root, "Dockerfile.fork.dockerignore"), "utf8");
    expect(ignore).toContain("\n**\n");
    expect(ignore).not.toContain("!.next");
  });
});

describe("release source and input validation", () => {
  it.each(["fork-v0.1.0", "fork-v12.34.56"])("accepts own stable version %s", (value) =>
    expect(isVersion(value)).toBe(true),
  );
  it.each([
    "v0.1.0",
    "fork-v01.1.0",
    "fork-v1.2",
    "fork-v1.2.3-rc.1",
    "fork-v1.2.3\n",
    "$(id)",
    "fork-v1.2.3/other",
    null,
  ])("rejects version %j", (value) => expect(isVersion(value)).toBe(false));
  it.each(["main", "A".repeat(40), "a".repeat(39), `${sha}\n`, null])("rejects non-SHA %j", (value) =>
    expect(isSha(value)).toBe(false),
  );
  it.each([
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REF: "refs/tags/fork-v0.1.0" },
    { GITHUB_REPOSITORY: "someone/homepage" },
    { GITHUB_WORKFLOW_REF: "other" },
    { RELEASE_PUBLISH: "yes" },
    { RELEASE_PUBLISH: "true" },
    { RELEASE_PUBLISH: "true", RELEASE_VERSION: "fork-v0.1.0", RELEASE_ENABLED: "true", GITHUB_RUN_ATTEMPT: "2" },
  ])("rejects untrusted/unconfirmed context %j", (patch) =>
    expect(() => releaseContext({ ...env, ...patch })).toThrow(),
  );
  it("allows build-only without credentials and requires explicit enabled version for publishing", async () => {
    expect(releaseContext(env)).toMatchObject({ publish: false });
    const get = async (path) =>
      path.endsWith("/deployment-branch-policies")
        ? { branch_policies: [{ name: "main", type: "branch" }] }
        : { deployment_branch_policy: { custom_branch_policies: true, protected_branches: false } };
    await expect(verifyReleaseEnvironment(get)).resolves.toBeUndefined();
    await expect(verifyReleaseEnvironment(async () => ({}))).rejects.toThrow("ENVIRONMENT_NOT_MAIN_ONLY");
    await expect(
      verifyReleaseEnvironment(async (path) =>
        path.endsWith("/deployment-branch-policies")
          ? { branch_policies: [{ name: "*", type: "tag" }] }
          : await get(path),
      ),
    ).rejects.toThrow("ENVIRONMENT_NOT_MAIN_ONLY");
    expect(
      releaseContext({ ...env, RELEASE_PUBLISH: "true", RELEASE_VERSION: plan.version, RELEASE_ENABLED: "true" }),
    ).toMatchObject({ publish: true });
  });
  it("resolves real main-ancestor tag, checks infrastructure and computes upstream base without moving refs", async () => {
    const r = repository();
    const before = git(r.directory, "show-ref");
    const result = await prepareRelease(r.directory, r.context, r.get, undefined, () => r.base);
    expect(result).toMatchObject({ source_sha: r.base, main_sha: r.main, version: plan.version, upstream_sha: r.base });
    expect(git(r.directory, "show-ref")).toBe(before);
    expect(git(r.directory, "status", "--porcelain")).toBe("");
  });
  it("rejects moved main, moved tags, changed release infrastructure and non-main sources", async () => {
    const r = repository();
    await expect(verifyReleaseSource(r.directory, r.context, async () => ({ commit: { sha } }))).rejects.toThrow(
      "MAIN_MOVED",
    );
    await expect(
      verifyReleaseSource(r.directory, r.context, async (p) =>
        p.endsWith("/branches/main") ? { commit: { sha: r.main } } : { object: { type: "commit", sha: r.main } },
      ),
    ).rejects.toThrow("TAG_MOVED");
    put(r.directory, RELEASE_FILES[0], "changed\n");
    git(r.directory, "add", ".");
    git(r.directory, "commit", "-m", "change policy");
    const changed = git(r.directory, "rev-parse", "HEAD");
    await expect(
      verifyReleaseSource(r.directory, { ...r.context, GITHUB_SHA: changed }, async (p) =>
        p.endsWith("/branches/main") ? { commit: { sha: changed } } : { object: { type: "commit", sha: r.base } },
      ),
    ).rejects.toThrow("RELEASE_INFRASTRUCTURE_CHANGED");
    git(r.directory, "checkout", "-b", "untrusted", r.base);
    put(r.directory, "untrusted.txt");
    git(r.directory, "add", ".");
    git(r.directory, "commit", "-m", "untrusted");
    const branch = git(r.directory, "rev-parse", "HEAD");
    git(r.directory, "tag", "fork-v9.9.9");
    git(r.directory, "checkout", "main");
    await expect(
      verifyReleaseSource(
        r.directory,
        { ...r.context, GITHUB_SHA: changed, RELEASE_VERSION: "fork-v9.9.9" },
        async (p) =>
          p.endsWith("/branches/main") ? { commit: { sha: changed } } : { object: { type: "commit", sha: branch } },
      ),
    ).rejects.toThrow("SOURCE_NOT_ON_MAIN");
  });
  it("uses fixed-host GETs with credentials only in headers and refuses redirects/errors", async () => {
    const fetcher = vi.fn(async () => new Response('{"ok":true}'));
    await githubGet(`/repos/${REPOSITORY}/branches/main`, "synthetic", fetcher);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      headers: { Authorization: "Bearer synthetic" },
    });
    await expect(githubGet("https://evil.invalid/", "synthetic", fetcher)).rejects.toThrow("INVALID_API_PATH");
    await expect(
      githubGet(`/repos/${REPOSITORY}/branches/main`, "synthetic", async () => new Response("{}", { status: 403 })),
    ).rejects.toThrow("GITHUB_READ_FAILED");
  });
});

describe("committed image context, not operator working tree", () => {
  it.each([
    "config/services.yaml",
    ".env.production.local",
    ".git/config",
    ".next/standalone/server.js",
    "node_modules/x",
    "src/x/.env",
    "public/key.pem",
    "public/key.p12",
    "src/x.test.jsx",
    "src/__tests__/x.js",
    "src/../config/x",
  ])("excludes %s", (path) => expect(allowedContextPath(path)).toBe(false));
  it("includes the Tailwind config referenced by src/styles/globals.css", () => {
    expect(allowedContextPath("tailwind.config.js")).toBe(true);
    const r = repository();
    put(r.directory, "src/styles/globals.css", "@config '../../tailwind.config.js';\n");
    put(r.directory, "tailwind.config.js", "module.exports = {};\n");
    git(r.directory, "add", ".");
    git(r.directory, "commit", "-m", "style fixture");
    const head = git(r.directory, "rev-parse", "HEAD");
    const paths = createImageContext(r.directory, head, join(r.directory, "style-output"));
    expect(paths).toContain("tailwind.config.js");
    expect(paths).toContain("src/styles/globals.css");
  });
  it("exports only allowed committed bytes, preserves binary data and ignores dirty private files", () => {
    const r = repository();
    put(r.directory, "config/services.yaml", "PRIVATE");
    put(r.directory, ".env", "PRIVATE");
    put(r.directory, "src/app.js", "dirty");
    const destination = join(r.directory, "output");
    const paths = createImageContext(r.directory, r.main, destination);
    expect(paths).toContain("src/app.js");
    expect(readFileSync(join(destination, "src/app.js"), "utf8")).toBe("fixture\n");
    expect(readFileSync(join(destination, "public/binary.png"))).toEqual(Buffer.from([0, 255, 127, 200]));
    expect(existsSync(join(destination, "config"))).toBe(false);
    expect(existsSync(join(destination, ".git"))).toBe(false);
    expect(() => createImageContext(r.directory, r.main, destination)).toThrow("CONTEXT_ALREADY_EXISTS");
  });
  it("rejects allowed symlinks rather than reading files outside the context", () => {
    const r = repository();
    symlinkSync("../../config/services.yaml", join(r.directory, "public/link"));
    git(r.directory, "add", ".");
    git(r.directory, "commit", "-m", "symlink");
    expect(() =>
      createImageContext(r.directory, git(r.directory, "rev-parse", "HEAD"), join(r.directory, "output")),
    ).toThrow("UNSAFE_CONTEXT_FILE_MODE");
  });
});

const rawIndex = JSON.stringify({
  manifests: [
    { platform: { os: "linux", architecture: "amd64" } },
    { platform: { os: "linux", architecture: "arm64" } },
  ],
});
const manifestDigest = `sha256:${createHash("sha256").update(rawIndex).digest("hex")}`;
function metadataTool(_command, args) {
  if (args.includes("--raw")) return rawIndex;
  if (args.includes("--config"))
    return JSON.stringify({
      os: "linux",
      architecture: args[args.indexOf("--override-arch") + 1],
      config: {
        Labels: {
          "org.opencontainers.image.revision": plan.source_sha,
          "org.opencontainers.image.version": plan.version,
          "org.opencontainers.image.source": `https://github.com/${REPOSITORY}`,
          "org.opencontainers.image.created": plan.created,
          "org.opencontainers.image.licenses": "GPL-3.0-only",
          "io.homepage.fork.upstream-revision": upstream,
        },
      },
    });
  return "";
}
function publishing() {
  const published = new Set();
  const tool = vi.fn((command, args) => {
    if (args[0] === "copy") published.add(args.at(-1).split(":").at(-1));
    return metadataTool(command, args);
  });
  return {
    tool,
    digest: async () => "f".repeat(64),
    getToken: vi.fn(async () => "synthetic-bearer"),
    auth: vi.fn(async (_user, _token, callback) => callback(99)),
    readManifest: vi.fn(async (_image, tag) => (published.has(tag) ? { digest: manifestDigest } : null)),
  };
}
const request = {
  archive: "/fixture/image.tar",
  plan,
  image: "fixture/homepage",
  username: "fixture",
  token: "synthetic-not-real",
  archiveSha: "f".repeat(64),
};

describe("OCI publication checks (mock registry/tools, not Docker Hub proof)", () => {
  it.each([
    "fixture",
    "fixture//team",
    "docker.io/fixture/homepage",
    "fixture/homepage:latest",
    "../homepage",
    "fixture/homepage\n",
  ])("rejects noncanonical image %j", (image) => expect(() => imageName("fixture", image)).toThrow());
  it.each(["Fixture", "fixture\n", "fixture:password", "fixture/user"])("rejects username %j", (username) =>
    expect(() => imageName(username, "fixture/homepage")).toThrow(),
  );
  it("defaults to username/homepage and supports an explicit organization repository", () => {
    expect(imageName("fixture")).toBe("fixture/homepage");
    expect(imageName("fixture", "organization/homepage")).toBe("organization/homepage");
  });
  it("verifies both architectures and exact labels before any credentials or writes", () => {
    expect(inspectArchive(request.archive, plan, metadataTool)).toBe(manifestDigest);
    expect(() => inspectArchive(request.archive, { ...plan, source_sha: upstream }, metadataTool)).toThrow(
      "IMAGE_LABEL_MISMATCH",
    );
    expect(() => inspectArchive(request.archive, plan, () => '{"manifests":[]}')).toThrow("EXPECTED_TWO_PLATFORMS");
  });
  it("copies exactly two immutable aliases, preserves digest and only passes an auth FD", async () => {
    const deps = publishing();
    const result = await publishArchive(request, deps);
    expect(result.digest).toBe(manifestDigest);
    expect(result.tags).toEqual([plan.version, `sha-${sha}`]);
    const copies = deps.tool.mock.calls.filter((c) => c[1][0] === "copy");
    expect(copies).toHaveLength(2);
    for (const call of copies) {
      expect(call[1]).toEqual(
        expect.arrayContaining(["--all", "--preserve-digests", "--retry-times=0", "--authfile=/proc/self/fd/3"]),
      );
      expect(JSON.stringify(call)).not.toContain(request.token);
      expect(call[2]).toBe(99);
    }
  });
  it("refuses existing tags, archive substitution and unknown registry state without writes", async () => {
    const existing = publishing();
    existing.readManifest.mockResolvedValue({ digest: manifestDigest });
    await expect(publishArchive(request, existing)).rejects.toThrow("IMAGE_TAG_ALREADY_EXISTS");
    expect(existing.auth).not.toHaveBeenCalled();
    const badArchive = publishing();
    badArchive.digest = async () => "0".repeat(64);
    await expect(publishArchive(request, badArchive)).rejects.toThrow("ARCHIVE_DIGEST_MISMATCH");
    expect(badArchive.getToken).not.toHaveBeenCalled();
    const unknown = publishing();
    unknown.readManifest.mockRejectedValue(new Error("network"));
    await expect(publishArchive(request, unknown)).rejects.toThrow();
    expect(unknown.auth).not.toHaveBeenCalled();
  });
  it("never retries an uncertain copy or silently repairs a partial publication", async () => {
    const deps = publishing();
    const normal = deps.tool.getMockImplementation();
    deps.tool.mockImplementation((command, args) => {
      if (args[0] === "copy") throw new Error("unknown write response");
      return normal(command, args);
    });
    await expect(publishArchive(request, deps)).rejects.toThrow();
    expect(deps.tool.mock.calls.filter((c) => c[1][0] === "copy")).toHaveLength(1);
  });
  it.each([401, 403, 429, 500])("fails closed on registry HTTP %i", async (status) => {
    await expect(
      registryManifest(
        "fixture/homepage",
        plan.version,
        "synthetic",
        async () => new Response('{"errors":[{"code":"DENIED"}]}', { status }),
      ),
    ).rejects.toThrow("REGISTRY_READ_FAILED");
  });
  it("only treats explicit missing manifests as absent, not missing repos or malformed data", async () => {
    expect(
      await registryManifest(
        request.image,
        plan.version,
        "synthetic",
        async () => new Response('{"errors":[{"code":"MANIFEST_UNKNOWN"}]}', { status: 404 }),
      ),
    ).toBeNull();
    for (const body of ['{"errors":[{"code":"NAME_UNKNOWN"}]}', "{}", "not JSON"])
      await expect(
        registryManifest(request.image, plan.version, "synthetic", async () => new Response(body, { status: 404 })),
      ).rejects.toThrow();
    const fetcher = vi.fn(async () => new Response('{"token":"synthetic-bearer"}'));
    await registryToken(request.image, request.username, request.token, fetcher);
    expect(fetcher.mock.calls[0][0]).not.toContain(request.token);
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
  });
  it("checks both emulated runtime structures and application gates before hashing the unchanged archive", async () => {
    const tool = vi.fn(metadataTool);
    const application = vi.fn(async () => [
      { healthy: true, checks: 90 },
      { healthy: true, checks: 90 },
    ]);
    const hash = vi.fn(async () => "f".repeat(64));
    await expect(smokeArchive(request.archive, plan, { tool, application, hash, report: vi.fn() })).resolves.toBe(
      manifestDigest,
    );
    expect(application.mock.calls.map(([, arch]) => arch)).toEqual(["amd64", "arm64"]);
    expect(hash).toHaveBeenCalledTimes(2);
    const runs = tool.mock.calls.filter(([command, args]) => command === "docker" && args[0] === "run");
    expect(runs).toHaveLength(2);
    for (const [, args] of runs)
      expect(args).toEqual(expect.arrayContaining(["--rm", "--read-only", "--network", "none", "--cap-drop=ALL"]));
    expect(tool.mock.calls.filter(([command, args]) => command === "docker" && args[0] === "image")).toHaveLength(2);
  });
  it("fails on an application gate failure and still removes the loaded image", async () => {
    const tool = vi.fn(metadataTool);
    const application = vi.fn(async () => {
      throw new Error("HTTP_GATE_FAILED");
    });
    await expect(
      smokeArchive(request.archive, plan, { tool, application, hash: async () => "fixture" }),
    ).rejects.toThrow("HTTP_GATE_FAILED");
    expect(application).toHaveBeenCalledTimes(1);
    expect(tool.mock.calls.filter(([command, args]) => command === "docker" && args[0] === "image")).toHaveLength(1);
  });
  it("rejects archive mutation or incomplete application verification", async () => {
    const deps = {
      tool: metadataTool,
      application: async () => [
        { healthy: true, checks: 1 },
        { healthy: true, checks: 1 },
      ],
      hash: vi.fn().mockResolvedValueOnce("before").mockResolvedValue("after"),
      report: vi.fn(),
    };
    await expect(smokeArchive(request.archive, plan, deps)).rejects.toThrow("SMOKE_ARCHIVE_CHANGED");
    await expect(smokeArchive(request.archive, plan, { ...deps, application: async () => [] })).rejects.toThrow(
      "APPLICATION_SMOKE_INCOMPLETE",
    );
  });
  it.skipIf(process.platform !== "linux" || !existsSync("/dev/shm"))(
    "keeps auth only in an unlinked tmpfs FD readable by the child, not argv/env",
    async () => {
      await withRegistryAuth("fixture", "synthetic", async (fd) => {
        expect(readlinkSync(`/proc/self/fd/${fd}`)).toContain("(deleted)");
        const result = spawnSync(
          process.execPath,
          ["-e", "process.stdout.write(require('node:fs').readFileSync('/proc/self/fd/3','utf8'))"],
          { stdio: ["ignore", "pipe", "pipe", fd], encoding: "utf8", env: {} },
        );
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout).auths["docker.io"].auth).toBe(
          Buffer.from("fixture:synthetic").toString("base64"),
        );
      });
      vi.stubEnv("DOCKERHUB_TOKEN", "synthetic");
      expect(runTool(process.execPath, ["-e", "process.stdout.write(String(process.env.DOCKERHUB_TOKEN))"])).toBe(
        "undefined",
      );
      const file = join(temporary(), "image.tar");
      writeFileSync(file, "fixture");
      expect(await fileDigest(file)).toBe(createHash("sha256").update("fixture").digest("hex"));
    },
  );
});
