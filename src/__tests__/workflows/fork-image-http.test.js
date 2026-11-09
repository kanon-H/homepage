// @vitest-environment node
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applicationFixture,
  requestLoopback,
  runDocker,
  verifyApplication,
  verifyApplicationHttp,
} from "../../../scripts/fork-image-http.mjs";

const servers = [];
const directories = [];
const password = "synthetic-not-a-real-password";
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function listen(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

// Real loopback HTTP and cookie handling, but intentionally NOT a Homepage/Docker acceptance result.
async function fixtureServer(fault) {
  const fixture = applicationFixture();
  const seen = [];
  const sessions = new Set();
  const services = [{ name: fixture.service, href: fixture.href }];
  const base = await listen(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const form = new URLSearchParams(Buffer.concat(chunks).toString());
    const cookies = Object.fromEntries(
      (req.headers.cookie || "")
        .split("; ")
        .filter(Boolean)
        .map((item) => item.split("=")),
    );
    const authenticated = sessions.has(cookies.session);
    seen.push({ path: req.url, authenticated, host: req.headers.host });
    res.setHeader("Cache-Control", fault === "cache" ? "public, max-age=60" : "private, no-store");
    const send = (status, body) => {
      res.statusCode = status;
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    if (req.headers.host !== "localhost:3000" && fault !== "host") return send(400, "Host validation failed");
    if (req.url === "/api/healthcheck") return send(200, "up");
    if (req.url === "/api/auth/csrf") {
      res.setHeader("Set-Cookie", ["csrf=synthetic-csrf-token; Path=/; HttpOnly", "callback=synthetic; Path=/"]);
      return send(200, { csrfToken: "synthetic-csrf-token" });
    }
    if (req.url === "/api/auth/callback/credentials") {
      if (cookies.csrf !== form.get("csrfToken") || (form.get("password") !== password && fault !== "password"))
        return send(401, { url: "/auth/signin?error=CredentialsSignin" });
      sessions.add("synthetic-session");
      res.setHeader("Set-Cookie", ["session=synthetic-session; Path=/; HttpOnly"]);
      return send(200, { url: "http://localhost:3000/" });
    }
    if (req.url === "/api/auth/session") return send(200, authenticated ? { expires: "2099-01-01T00:00:00.000Z" } : {});
    if (req.url === "/api/auth/signout") {
      if (fault !== "signout") {
        sessions.delete(cookies.session);
        res.setHeader("Set-Cookie", ["session=; Path=/; Max-Age=0"]);
      }
      return send(200, { url: "http://localhost:3000/" });
    }
    if (!authenticated && fault !== "public") {
      res.setHeader(
        req.url.startsWith("/_next/data/") ? "x-nextjs-redirect" : "Location",
        fault === "redirect" || (fault === "next-redirect" && req.url.startsWith("/_next/data/"))
          ? "https://elsewhere.example.invalid/auth/signin"
          : "/auth/signin?callbackUrl=%2F",
      );
      if (fault === "conflicting-redirect")
        res.setHeader("x-nextjs-redirect", "https://elsewhere.example.invalid/auth/signin");
      return send(307, "Redirecting");
    }
    if (req.url === "/")
      return send(
        200,
        `${fault === "mount" ? "not-mounted" : fixture.service} ${fixture.bookmark} ${fault === "secret" ? password : ""}`,
      );
    if (req.url === "/api/services") return send(200, services);
    if (req.url === "/api/bookmarks") return send(200, [{ name: fixture.bookmark, href: fixture.bookmarkHref }]);
    if (req.url === "/api/widgets") return send(200, []);
    if (req.url === "/_next/data/build-fixture/en.json")
      return send(200, { pageProps: { fallback: { "/api/services": fault === "data" ? [] : services } } });
    return send(404, "Not found");
  });
  return { base, fixture, seen };
}

function dockerFixture(fault) {
  let volume;
  let name;
  let mount;
  let environment;
  let files;
  const resources = { containers: new Set(), volumes: new Set() };
  const tool = vi.fn((args, options = {}) => {
    if (args[0] === "volume" && args[1] === "create") {
      volume = args.at(-1);
      resources.volumes.add(volume);
      return volume;
    }
    if (args[0] === "run") {
      // Two run steps now exist: the root chown pass and the identity-matched seed.
      // Only the seed carries fixture files on stdin.
      if (options.input !== undefined) files = JSON.parse(options.input);
      return "";
    }
    if (args[0] === "create") {
      name = args[args.indexOf("--name") + 1];
      mount = args[args.indexOf("--mount") + 1].split("target=")[1];
      // Env values now arrive as repeated "--env KEY=value" pairs, not stdin.
      environment = Object.fromEntries(
        args
          .filter((_value, index) => args[index - 1] === "--env")
          .map((pair) => {
            const i = pair.indexOf("=");
            return [pair.slice(0, i), pair.slice(i + 1)];
          }),
      );
      resources.containers.add(name);
      if (fault === "create") throw new Error("UNCERTAIN_CREATE");
      return "fixture-container";
    }
    if (args[0] === "inspect")
      return JSON.stringify({
        Running: fault !== "exited",
        Health: { Status: fault === "unhealthy" ? "unhealthy" : fault === "timeout" ? "starting" : "healthy" },
      });
    if (args[0] === "port") return fault === "port" ? "0.0.0.0:12345\n" : "127.0.0.1:12345\n";
    if (args[0] === "exec") {
      // Execute the actual generated verifier against a fixture FS, catching escaping and identity bugs.
      const stdout = [];
      const fakeFs = {
        readFileSync(path) {
          if (path === "/proc/1/status")
            return `Name:\tnode\nUid:\t${Array(4)
              .fill(fault === "identity" ? 42 : environment.PUID)
              .join("\t")}\nGid:\t${Array(4).fill(environment.PGID).join("\t")}\n`;
          if (path === "/app/.next/BUILD_ID") return "build-fixture\n";
          return files[path.replace("/app/config/", "")];
        },
        realpathSync: () => (fault === "alias" ? "/app/config" : mount),
        writeFileSync(path, text) {
          files[path.replace("/app/config/", "")] = text;
        },
        unlinkSync(path) {
          delete files[path.replace("/app/config/", "")];
        },
      };
      runInNewContext(args.at(-1), {
        require: () => fakeFs,
        process: {
          arch: args.join(" ").includes("'arm64'") ? "arm64" : "x64",
          getuid: () => Number(environment.PUID),
          getgid: () => Number(environment.PGID),
          stdout: { write: (text) => stdout.push(text) },
        },
      });
      return stdout.join("");
    }
    if (args[0] === "container" && args[1] === "ls")
      return fault === "foreign" ? "not-our-container" : [...resources.containers].join("\n");
    if (args[0] === "volume" && args[1] === "ls") return [...resources.volumes].join("\n");
    if (args[0] === "container" && args[1] === "rm") resources.containers.delete(args.at(-1));
    if (args[0] === "volume" && args[1] === "rm") resources.volumes.delete(args.at(-1));
    return "";
  });
  return { tool, resources, probe: vi.fn(async () => 100), pause: vi.fn(async () => {}) };
}

describe("isolated application HTTP verifier", () => {
  it("exercises cookies, native-shaped auth, all protected paths, warming, logout and Host over real loopback HTTP", async () => {
    const { base, fixture, seen } = await fixtureServer();
    expect(await verifyApplicationHttp(base, fixture, password, "build-fixture")).toBeGreaterThan(90);
    expect(seen.some((entry) => entry.path.startsWith("/_next/data/") && entry.authenticated)).toBe(true);
    expect(seen.filter((entry) => entry.path === "/api/services" && !entry.authenticated)).toHaveLength(5);
  });
  it.each([
    ["public", "SMOKE_ANONYMOUS_INVENTORY_EXPOSED"],
    ["cache", "SMOKE_PRIVATE_CACHE_MISSING"],
    ["host", "SMOKE_HOST_VALIDATION_FAILED"],
    ["password", "SMOKE_WRONG_PASSWORD_ACCEPTED"],
    ["signout", "SMOKE_SIGNOUT_SESSION_RETAINED"],
    ["redirect", "SMOKE_UNSAFE_AUTH_REDIRECT"],
    ["next-redirect", "SMOKE_UNSAFE_AUTH_REDIRECT"],
    ["conflicting-redirect", "SMOKE_UNSAFE_AUTH_REDIRECT"],
    ["mount", "SMOKE_MOUNTED_DASHBOARD_MISSING"],
    ["secret", "SMOKE_PASSWORD_EXPOSED"],
    ["data", "SMOKE_NEXT_DATA_MISMATCH"],
  ])("rejects the %s regression without weakening auth/cache assertions", async (fault, code) => {
    const { base, fixture } = await fixtureServer(fault);
    await expect(verifyApplicationHttp(base, fixture, password, "build-fixture")).rejects.toThrow(code);
  });
  it.each([
    "http://localhost:3000",
    "https://127.0.0.1:3000",
    "http://user@127.0.0.1:3000",
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
    "http://127.0.0.1:3000/path",
    "http://elsewhere.example.invalid:3000",
  ])("rejects non-loopback or malformed base %s", (base) => {
    expect(() => requestLoopback(base, "/")).toThrow();
  });
  it.each([
    "//elsewhere.example.invalid",
    "https://elsewhere.example.invalid/",
    "/\r\nHost: example.invalid",
    "relative",
  ])("rejects unsafe request path %j", (path) => {
    expect(() => requestLoopback("http://127.0.0.1:3000", path)).toThrow("INVALID_SMOKE_PATH");
  });
  it("never follows a redirect and never relies on HTTP_PROXY or operator cookies", async () => {
    vi.stubEnv("HTTP_PROXY", "http://must-not-use.example.invalid");
    let count = 0;
    const base = await listen((_req, res) => {
      count += 1;
      res.writeHead(302, { Location: "https://elsewhere.example.invalid/" });
      res.end("redirect");
    });
    expect((await requestLoopback(base, "/")).status).toBe(302);
    expect(count).toBe(1);
  });
  it("bounds HTTP response size", async () => {
    const base = await listen((_req, res) => res.end(Buffer.alloc(2 * 1024 * 1024 + 1)));
    await expect(requestLoopback(base, "/")).rejects.toThrow("SMOKE_HTTP_FAILED");
  });
  it("uses fresh fictional YAML without any password, widgets, monitors or real destinations", () => {
    const first = applicationFixture();
    const next = applicationFixture();
    expect(first.service).not.toBe(next.service);
    expect(JSON.parse(first.files["widgets.yaml"])).toEqual([]);
    expect(first.files["services.yaml"]).not.toMatch(/password|apiKey|siteMonitor|ping/);
    expect(first.files["services.yaml"]).toContain(".example.invalid");
    expect(first.files).toHaveProperty("custom.css", "");
  });
});

describe("Docker application orchestration (mock Docker, not image acceptance)", () => {
  it.each(["amd64", "arm64"])(
    "checks root/direct and non-root/alias mounts, real health, PID1, write access and cleanup for %s",
    async (arch) => {
      const deps = dockerFixture();
      expect(await verifyApplication("fixture-image", arch, deps)).toEqual([
        { platform: `linux/${arch}`, mount: "/app/config", uid: 0, gid: 0, checks: 100, healthy: true },
        { platform: `linux/${arch}`, mount: "/config", uid: 10001, gid: 10002, checks: 100, healthy: true },
      ]);
      expect(deps.resources.containers.size + deps.resources.volumes.size).toBe(0);
      const creates = deps.tool.mock.calls.filter(([args]) => args[0] === "create");
      expect(creates).toHaveLength(2);
      for (const [args, options] of creates) {
        // /dev/stdin is not reopenable when stdin is a pipe, so env values are inline.
        expect(args).not.toContain("--env-file=/dev/stdin");
        expect(options?.input).toBeUndefined();
        const envValues = args.filter((_value, index) => args[index - 1] === "--env");
        expect(envValues).toContain("HOMEPAGE_AUTH_ENABLED=true");
        expect(envValues.some((value) => value.startsWith("HOMEPAGE_AUTH_PASSWORD="))).toBe(true);
        expect(args).toContain("127.0.0.1::3000");
        expect(args).not.toEqual(expect.arrayContaining(["--privileged", "--network=host", "--restart=always"]));
        expect(envValues.join("\n")).not.toMatch(/DOCKERHUB_|GITHUB_TOKEN|NEXTAUTH_SECRET/);
      }
      expect(deps.tool.mock.calls.filter(([args]) => args[0] === "exec")).toHaveLength(4);
    },
  );
  it.each([
    ["create", "UNCERTAIN_CREATE"],
    ["exited", "SMOKE_CONTAINER_UNHEALTHY"],
    ["unhealthy", "SMOKE_CONTAINER_UNHEALTHY"],
    ["timeout", "SMOKE_CONTAINER_START_TIMEOUT"],
    ["port", "SMOKE_PORT_NOT_LOOPBACK"],
    ["identity", "Wrong server identity"],
  ])("fails %s closed and cleans its own resources, including uncertain create responses", async (fault, code) => {
    const deps = dockerFixture(fault);
    await expect(verifyApplication("fixture-image", "arm64", deps)).rejects.toThrow(code);
    expect(deps.resources.containers.size + deps.resources.volumes.size).toBe(0);
    expect(deps.probe).not.toHaveBeenCalled();
  });
  it("does not accept an ignored /config alias", async () => {
    const deps = dockerFixture("alias");
    await expect(verifyApplication("fixture-image", "amd64", deps)).rejects.toThrow("Wrong config mount");
    expect(deps.probe).toHaveBeenCalledTimes(1);
    expect(deps.resources.containers.size + deps.resources.volumes.size).toBe(0);
  });
  it("cleans after HTTP probe failure without retrying or starting another container", async () => {
    const deps = dockerFixture();
    deps.probe.mockRejectedValue(new Error("HTTP_FAILED"));
    await expect(verifyApplication("fixture-image", "amd64", deps)).rejects.toThrow("HTTP_FAILED");
    expect(deps.probe).toHaveBeenCalledTimes(1);
    expect(deps.resources.containers.size + deps.resources.volumes.size).toBe(0);
  });
  it("pre-owns the volume for PUID and seeds as that identity, never as root", async () => {
    const deps = dockerFixture();
    await verifyApplication("fixture-image", "amd64", deps);
    const runs = deps.tool.mock.calls.filter(([args]) => args[0] === "run");
    // One chown pass plus one seed per mount mode.
    expect(runs).toHaveLength(4);
    for (let index = 0; index < runs.length; index += 2) {
      const [chownArgs] = runs[index];
      const [seedArgs, seedOptions] = runs[index + 1];
      expect(chownArgs[chownArgs.indexOf("--user") + 1]).toBe("0:0");
      expect(chownArgs).toContain("--cap-add=CHOWN");
      expect(chownArgs.join(" ")).toMatch(/chown \d+:\d+ \/fixture/);
      const identity = seedArgs[seedArgs.indexOf("--user") + 1];
      expect(identity).toMatch(/^(0:0|10001:10002)$/);
      expect(chownArgs.join(" ")).toContain(`chown ${identity} /fixture`);
      expect(seedOptions.input).toBeTypeOf("string");
    }
  });
  it("never lets a cleanup failure hide the gate that actually failed", async () => {
    // Real incident: `docker create --env-file=/dev/stdin` failed, but `finally`
    // cleanup also failed (no docker CLI in PATH) and replaced the real error, so
    // four CI runs only ever showed a cleanup code.
    const deps = dockerFixture();
    deps.probe.mockRejectedValue(new Error("REAL_GATE_FAILURE"));
    const cleanupBroken = vi.fn((args, options) => {
      if (args[0] === "container" && args[1] === "ls") throw new Error("docker ENOENT");
      return deps.tool(args, options);
    });
    await expect(verifyApplication("fixture-image", "amd64", { ...deps, tool: cleanupBroken })).rejects.toThrow(
      /REAL_GATE_FAILURE.*cleanup also failed|REAL_GATE_FAILURE/,
    );
  });
  it("still surfaces a cleanup failure when the gate itself passed", async () => {
    const deps = dockerFixture();
    const cleanupBroken = vi.fn((args, options) => {
      if (args[0] === "container" && args[1] === "ls") throw new Error("CLEANUP_ONLY_FAILURE");
      return deps.tool(args, options);
    });
    await expect(verifyApplication("fixture-image", "amd64", { ...deps, tool: cleanupBroken })).rejects.toThrow(
      /CLEANUP/,
    );
  });
  it("never deletes an unexpectedly named resource even if it matches the label", async () => {
    const deps = dockerFixture("foreign");
    await expect(verifyApplication("fixture-image", "amd64", deps)).rejects.toThrow("SMOKE_CONTAINER_CLEANUP_FAILED");
    expect(deps.tool.mock.calls.some(([args]) => args.includes("not-our-container") && args.includes("rm"))).toBe(
      false,
    );
  });
  it("sanitizes child credentials/environment and only forwards synthetic runtime values through stdin", () => {
    const directory = mkdtempSync(join(tmpdir(), "homepage-smoke-tool-"));
    directories.push(directory);
    const executable = join(directory, "docker");
    writeFileSync(
      executable,
      `#!${process.execPath}\nconst fs = require('node:fs'); process.stdout.write(JSON.stringify({env: Object.fromEntries(['GITHUB_TOKEN','DOCKERHUB_TOKEN','HOMEPAGE_AUTH_PASSWORD','NEXTAUTH_SECRET','NODE_OPTIONS','DOCKER_HOST'].filter(key => process.env[key]).map(key => [key, process.env[key]])), input: fs.readFileSync(0, 'utf8')}));\n`,
    );
    chmodSync(executable, 0o700);
    vi.stubEnv("PATH", `${directory}:${process.env.PATH}`);
    for (const key of ["GITHUB_TOKEN", "DOCKERHUB_TOKEN", "HOMEPAGE_AUTH_PASSWORD", "NEXTAUTH_SECRET", "DOCKER_HOST"])
      vi.stubEnv(key, "synthetic-not-forwarded");
    expect(JSON.parse(runDocker(["fixture"], { input: "only-generated-fixture" }))).toEqual({
      env: {},
      input: "only-generated-fixture",
    });
  });
});
