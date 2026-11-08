import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { load } from "js-yaml";
import { afterEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const workflowDirectory = join(root, ".github/workflows");
const workflow = load(readFileSync(join(workflowDirectory, "fork-ci.yml"), "utf8"));
const job = workflow.jobs.verify;
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Fork CI policy", () => {
  it("checks main PRs, main pushes and manual runs without path filters", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "push", "workflow_dispatch"]);
    expect(workflow.on.pull_request).toEqual({ branches: ["main"] });
    expect(workflow.on.push).toEqual({ branches: ["main"] });
    expect(job.if).toBe("github.repository == 'kanon-H/homepage'");
  });

  it("has one stable read-only gate without registry credentials, coverage services or shared build caches", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(Object.keys(workflow.jobs)).toEqual(["verify"]);
    expect(job.name).toBe("Fork verification");
    expect(job.permissions).toBeUndefined();
    expect(job["runs-on"]).toBe("ubuntu-24.04");
    expect(job["timeout-minutes"]).toBe(30);
    const text = JSON.stringify(workflow);
    expect(text).not.toMatch(/secrets\.|packages|codecov|pull_request_target|cache@|cache:/i);
    expect(job.steps.filter((step) => step.uses).every((step) => /@[0-9a-f]{40}$/.test(step.uses))).toBe(true);
  });

  it("checks out the validated exact commit and does not persist Git credentials", () => {
    expect(job.env.SOURCE_SHA).toBe("${{ github.sha }}");
    expect(job.steps[0].name).toBe("Validate source commit");
    expect(job.steps[1].with).toEqual({ ref: "${{ env.SOURCE_SHA }}", "persist-credentials": false });
    expect(job.steps.find((step) => step.name === "Verify tool versions and source").run).toContain(
      'test "$(git rev-parse HEAD)" = "$SOURCE_SHA"',
    );
  });

  it("pins the locally verified Node and pnpm versions and freezes installation", () => {
    expect(job.steps.find((step) => step.name === "Install pnpm").with).toEqual({
      version: "10.34.9",
      run_install: false,
    });
    expect(job.steps.find((step) => step.name === "Setup Node.js").with).toEqual({ "node-version": "24.22.1" });
    expect(job.steps.filter((step) => step.run).map((step) => step.run)).toEqual(
      expect.arrayContaining([
        "pnpm install --frozen-lockfile",
        "pnpm lint",
        "pnpm test",
        "bash scripts/fork-ci-build.sh",
      ]),
    );
    expect(job.steps.some((step) => step["continue-on-error"])).toBe(false);
  });

  it.each([
    ["a".repeat(40), 0],
    ["main", 1],
    ["refs/heads/main", 1],
    ["a".repeat(39), 1],
    ["a".repeat(41), 1],
    ["A".repeat(40), 1],
    ["$(exit 0)", 1],
    ["a".repeat(40) + "\n", 1],
  ])("validates source %j without evaluating it", (source, status) => {
    const result = spawnSync("bash", ["-euo", "pipefail", "-c", job.steps[0].run], {
      env: { ...process.env, SOURCE_SHA: source },
      encoding: "utf8",
    });
    expect(result.status).toBe(status);
  });

  const inheritedWorkflows = readdirSync(workflowDirectory).filter(
    (name) => name.endsWith(".yml") && !name.startsWith("fork-"),
  );
  it.each(inheritedWorkflows)("keeps every inherited %s job restricted to the official repository", (name) => {
    const inherited = load(readFileSync(join(workflowDirectory, name), "utf8"));
    for (const inheritedJob of Object.values(inherited.jobs)) {
      expect(inheritedJob.if, `${name}: missing repository gate`).toContain(
        "github.repository == 'gethomepage/homepage'",
      );
    }
  });
});

function prepareBuild() {
  const directory = mkdtempSync(join(tmpdir(), "homepage-fork-ci-test-"));
  temporaryDirectories.push(directory);
  mkdirSync(join(directory, "scripts"));
  mkdirSync(join(directory, "bin"));
  mkdirSync(join(directory, "temp"));
  cpSync(join(root, "scripts/fork-ci-build.sh"), join(directory, "scripts/fork-ci-build.sh"));
  writeFileSync(
    join(directory, "bin/pnpm"),
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const config = process.env.HOMEPAGE_CONFIG_DIR;
const files = Object.fromEntries(fs.readdirSync(config).map(name => [name, JSON.parse(fs.readFileSync(path.join(config, name), 'utf8'))]));
console.log(JSON.stringify({
  args: process.argv.slice(2), config, files,
  authEnabled: process.env.HOMEPAGE_AUTH_ENABLED,
  hasSecret: process.env.HOMEPAGE_AUTH_SECRET.length >= 32,
  hasPassword: process.env.HOMEPAGE_AUTH_PASSWORD.length >= 24,
  externalUrl: process.env.HOMEPAGE_EXTERNAL_URL,
  allowedHosts: process.env.HOMEPAGE_ALLOWED_HOSTS,
  telemetryDisabled: process.env.NEXT_TELEMETRY_DISABLED,
  nodeEnv: process.env.NODE_ENV
}));
process.exit(Number(process.env.CI_TEST_BUILD_EXIT || 0));
`,
    { mode: 0o700 },
  );
  return directory;
}

function runBuild(directory, exit = 0) {
  return spawnSync("bash", [join(directory, "scripts/fork-ci-build.sh")], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${join(directory, "bin")}:${process.env.PATH}`,
      RUNNER_TEMP: join(directory, "temp"),
      CI_TEST_BUILD_EXIT: String(exit),
    },
    encoding: "utf8",
  });
}

describe("Fork CI production build isolation (mock pnpm, not a production build)", () => {
  it.each([0, 23])("uses fictional YAML, native auth and cleans temporary files after build exit %i", (exit) => {
    const directory = prepareBuild();
    const result = runBuild(directory, exit);
    expect(result.status, result.stderr).toBe(exit);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      args: ["build"],
      authEnabled: "true",
      hasSecret: true,
      hasPassword: true,
      externalUrl: "http://localhost:3000",
      allowedHosts: "localhost:3000",
      telemetryDisabled: "1",
      nodeEnv: "production",
    });
    expect(output.files["settings.yaml"].extensions.network).toEqual({
      enabled: true,
      modes: [{ id: "lan", label: "LAN" }],
    });
    expect(output.files["services.yaml"][0].CI[0].Fixture).toEqual({
      href: "https://default.example.invalid",
      extensions: { network: { addresses: { lan: "https://lan.example.invalid" } } },
    });
    expect(output.files["widgets.yaml"]).toEqual([]);
    expect(output.files["bookmarks.yaml"]).toEqual([]);
    expect(existsSync(output.config)).toBe(false);
    expect(readdirSync(join(directory, "temp"))).toEqual([]);
  });

  it.each([".env", ".env.local", ".env.production", ".env.production.local"])(
    "refuses automatic Next.js loading of %s",
    (name) => {
      const directory = prepareBuild();
      writeFileSync(join(directory, name), "CI_ONLY_FICTIONAL_VALUE=must-not-load\n");
      const result = runBuild(directory);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Refusing a build with local Next.js environment files");
      expect(result.stdout).toBe("");
      expect(readdirSync(join(directory, "temp"))).toEqual([]);
      expect(readFileSync(join(directory, name), "utf8")).toBe("CI_ONLY_FICTIONAL_VALUE=must-not-load\n");
    },
  );
});
