import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { request } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

import { parseMetadata } from "./fork-image-publish.mjs";
import { requireRelease } from "./fork-release.mjs";

const canonical = "http://localhost:3000";
const host = "localhost:3000";
const ownerLabel = "io.homepage.fork.smoke";

// No global proxy, redirects, browser credentials, external DNS or operator config.
export function requestLoopback(base, path, { method = "GET", headers = {}, body } = {}) {
  requireRelease(/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(base), "SMOKE_REQUIRES_LOOPBACK");
  const port = Number(base.split(":").at(-1));
  requireRelease(port <= 65535, "INVALID_SMOKE_PORT");
  requireRelease(/^\/(?!\/)[^\r\n#]*$/.test(path), "INVALID_SMOKE_PATH");
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", port, path, method, headers, timeout: 15000, signal: AbortSignal.timeout(15000) },
      (res) => {
        const chunks = [];
        let length = 0;
        res.on("data", (chunk) => {
          length += chunk.length;
          if (length > 2 * 1024 * 1024) res.destroy(new Error("SMOKE_RESPONSE_TOO_LARGE"));
          else chunks.push(chunk);
        });
        res.on("error", () => reject(new Error("SMOKE_HTTP_FAILED")));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", () => reject(new Error("SMOKE_HTTP_FAILED")));
    req.on("timeout", () => req.destroy(new Error("SMOKE_HTTP_TIMEOUT")));
    req.end(body);
  });
}

function client(base, transport) {
  const cookies = new Map();
  return async (path, form, requestHost = host) => {
    const body = form ? new URLSearchParams(form).toString() : undefined;
    const headers = {
      Host: requestHost,
      Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
    };
    if (form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers.Origin = canonical;
    }
    const response = await transport(base, path, { method: form ? "POST" : "GET", headers, body });
    for (const cookie of response.headers["set-cookie"] || []) {
      const [pair, ...attributes] = cookie.split(";");
      const index = pair.indexOf("=");
      requireRelease(index > 0, "INVALID_SMOKE_COOKIE");
      const key = pair.slice(0, index).trim();
      const value = pair.slice(index + 1);
      if (!value || attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute))) cookies.delete(key);
      else cookies.set(key, value);
    }
    return response;
  };
}

export function applicationFixture() {
  const id = randomUUID();
  const service = `Smoke-Service-${id}`;
  const bookmark = `Smoke-Bookmark-${id}`;
  const href = `https://default.example.invalid/${id}`;
  const bookmarkHref = `https://bookmark.example.invalid/${id}`;
  const files = {
    "settings.yaml": {
      title: `Smoke-Title-${id}`,
      language: "en",
      disableUpdateCheck: true,
      extensions: { network: { enabled: true, modes: [{ id: "lan", label: "LAN" }] } },
    },
    "services.yaml": [
      {
        "Smoke-Services": [
          { [service]: { href, extensions: { network: { addresses: { lan: `https://lan.example.invalid/${id}` } } } } },
        ],
      },
    ],
    "bookmarks.yaml": [{ "Smoke-Bookmarks": [{ [bookmark]: [{ abbr: "SM", href: bookmarkHref }] }] }],
    "widgets.yaml": [],
    "docker.yaml": {},
    "kubernetes.yaml": {},
    "proxmox.yaml": {},
  };
  return {
    service,
    bookmark,
    href,
    bookmarkHref,
    files: {
      ...Object.fromEntries(Object.entries(files).map(([name, value]) => [name, `${JSON.stringify(value)}\n`])),
      "custom.css": "",
      "custom.js": "",
    },
  };
}

// Native password auth only. Real OIDC, HTTPS/CDN and browser interaction remain separate gates.
export async function verifyApplicationHttp(base, fixture, password, buildId, transport = requestLoopback) {
  requireRelease(/^[A-Za-z0-9_-]{1,200}$/.test(buildId), "INVALID_SMOKE_BUILD_ID");
  const paths = ["/", "/api/services", "/api/bookmarks", "/api/widgets", `/_next/data/${buildId}/en.json`];
  const markers = [fixture.service, fixture.bookmark, "example.invalid"];
  let checks = 0;
  const check = (condition, code) => {
    requireRelease(condition, code);
    checks += 1;
  };
  const privateCache = (response) =>
    /(?:^|[,\s])private(?:[,\s]|$)/i.test(response.headers["cache-control"] || "") &&
    /(?:^|[,\s])no-store(?:[,\s]|$)/i.test(response.headers["cache-control"] || "");
  const protectedPaths = async (get) => {
    for (const path of paths) {
      const response = await get(path);
      check(
        [302, 307, 401].includes(response.status) && markers.every((marker) => !response.body.includes(marker)),
        "SMOKE_ANONYMOUS_INVENTORY_EXPOSED",
      );
      check(privateCache(response), "SMOKE_PRIVATE_CACHE_MISSING");
      if (response.status !== 401) {
        // Next.js data requests use x-nextjs-redirect instead of Location.
        const redirects = [response.headers.location, response.headers["x-nextjs-redirect"]].filter(Boolean);
        check(
          redirects.length > 0 &&
            redirects.every((value) => {
              const location = typeof value === "string" ? URL.parse(value, canonical) : null;
              return location?.origin === canonical && location.pathname === "/auth/signin";
            }),
          "SMOKE_UNSAFE_AUTH_REDIRECT",
        );
      }
    }
  };
  const anonymous = client(base, transport);
  const health = await anonymous("/api/healthcheck");
  check(health.status === 200 && health.body === "up", "SMOKE_HEALTHCHECK_FAILED");
  await protectedPaths(anonymous);
  for (const path of ["/", "/api/services", "/api/healthcheck", "/api/auth/csrf", paths.at(-1)]) {
    const response = await anonymous(path, undefined, "untrusted.example.invalid:3000");
    check(
      response.status === 400 && markers.every((marker) => !response.body.includes(marker)),
      "SMOKE_HOST_VALIDATION_FAILED",
    );
  }
  const csrf = async (get) => {
    const response = await get("/api/auth/csrf");
    const token = parseMetadata(response.body).csrfToken;
    check(response.status === 200 && typeof token === "string" && token.length >= 16, "SMOKE_CSRF_FAILED");
    return token;
  };
  const login = async (get, value) =>
    get("/api/auth/callback/credentials", {
      csrfToken: await csrf(get),
      password: value,
      callbackUrl: `${canonical}/`,
      json: "true",
    });
  const wrong = client(base, transport);
  const rejected = await login(wrong, `wrong-${password}`);
  check(rejected.status === 401, "SMOKE_WRONG_PASSWORD_ACCEPTED");
  const wrongSession = await wrong("/api/auth/session");
  check(wrongSession.status === 200 && !parseMetadata(wrongSession.body).expires, "SMOKE_WRONG_PASSWORD_SESSION");
  await protectedPaths(wrong);
  const authenticated = client(base, transport);
  const accepted = await login(authenticated, password);
  check(accepted.status === 200, "SMOKE_PASSWORD_LOGIN_FAILED");
  const session = await authenticated("/api/auth/session");
  check(session.status === 200 && Boolean(parseMetadata(session.body).expires), "SMOKE_SESSION_MISSING");
  let services;
  for (const path of paths) {
    // Repeat authenticated reads before the independent anonymous cache-isolation check.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await authenticated(path);
      check(response.status === 200 && privateCache(response), "SMOKE_AUTHENTICATED_RESPONSE_FAILED");
      check(!response.body.includes(password), "SMOKE_PASSWORD_EXPOSED");
      if (path === "/")
        check(
          response.body.includes(fixture.service) && response.body.includes(fixture.bookmark),
          "SMOKE_MOUNTED_DASHBOARD_MISSING",
        );
      if (path === "/api/services") {
        check(
          response.body.includes(fixture.service) && response.body.includes(fixture.href),
          "SMOKE_MOUNTED_SERVICES_MISSING",
        );
        services = parseMetadata(response.body);
      }
      if (path === "/api/bookmarks")
        check(
          response.body.includes(fixture.bookmark) && response.body.includes(fixture.bookmarkHref),
          "SMOKE_MOUNTED_BOOKMARKS_MISSING",
        );
      if (path === paths.at(-1))
        check(
          JSON.stringify(parseMetadata(response.body).pageProps?.fallback?.["/api/services"]) ===
            JSON.stringify(services),
          "SMOKE_NEXT_DATA_MISMATCH",
        );
    }
  }
  await protectedPaths(anonymous);
  const signout = await authenticated("/api/auth/signout", {
    csrfToken: await csrf(authenticated),
    callbackUrl: `${canonical}/`,
    json: "true",
  });
  check(signout.status === 200, "SMOKE_SIGNOUT_FAILED");
  // Retain the client's cookie jar: manually clearing it would mask a broken sign-out.
  const signedOutSession = await authenticated("/api/auth/session");
  check(
    signedOutSession.status === 200 && !parseMetadata(signedOutSession.body).expires,
    "SMOKE_SIGNOUT_SESSION_RETAINED",
  );
  await protectedPaths(authenticated);
  return checks;
}

export function runDocker(args, { input } = {}) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: "/nonexistent", LANG: "C.UTF-8" },
  });
  if (result.error || result.status !== 0) {
    // Diagnostics must stay secret-free: fixture credentials only travel via stdin,
    // so argv and stderr never contain them. Cap length to keep logs readable.
    const detail =
      String(result.stderr || result.error?.message || "")
        .split("\n")
        .filter(Boolean)[0] || "";
    throw new Error(
      `SMOKE_DOCKER_TOOL_FAILED:${args[0]}${args[1] ? "/" + args[1] : ""}:${String(result.status)}:${detail
        .replace(/[A-Za-z0-9+/=_-]{40,}/g, "<redacted>")
        .slice(0, 200)}`,
    );
  }
  return result.stdout;
}

function cleanup(tool, owner, name, volume) {
  // Query our unique labels even after an uncertain create/start response. Never prune shared resources.
  const errors = [];
  for (const [kind, expected] of [
    ["container", name],
    ["volume", volume],
  ]) {
    try {
      const names = tool([
        kind,
        "ls",
        ...(kind === "container" ? ["--all"] : []),
        "--filter",
        `label=${ownerLabel}=${owner}`,
        "--format",
        kind === "container" ? "{{.Names}}" : "{{.Name}}",
      ]);
      for (const found of names.trim().split("\n").filter(Boolean)) {
        requireRelease(
          found === expected || (kind === "container" && found === `${name}-seed`),
          "SMOKE_CLEANUP_OWNERSHIP_MISMATCH",
        );
        tool([kind, "rm", ...(kind === "container" ? ["--force"] : []), found]);
      }
    } catch {
      errors.push(`SMOKE_${kind.toUpperCase()}_CLEANUP_FAILED`);
    }
  }
  requireRelease(errors.length === 0, errors.join("_AND_"));
}

export async function verifyApplication(image, arch, deps = {}) {
  const tool = deps.tool || runDocker;
  const pause = deps.pause || delay;
  const probe = deps.probe || verifyApplicationHttp;
  requireRelease(["amd64", "arm64"].includes(arch), "INVALID_SMOKE_ARCHITECTURE");
  const results = [];
  for (const [mount, uid, gid] of [
    ["/app/config", 0, 0],
    ["/config", 10001, 10002],
  ]) {
    const owner = randomUUID();
    const name = `homepage-fork-http-${owner}`;
    const volume = `${name}-config`;
    const fixture = applicationFixture();
    const password = randomBytes(32).toString("hex");
    const secret = randomBytes(48).toString("hex");
    try {
      requireRelease(
        tool(["volume", "create", "--label", `${ownerLabel}=${owner}`, volume]).trim() === volume,
        "SMOKE_VOLUME_CREATE_FAILED",
      );
      tool(
        [
          "run",
          "--rm",
          "--name",
          `${name}-seed`,
          "--label",
          `${ownerLabel}=${owner}`,
          "--interactive",
          "--platform",
          `linux/${arch}`,
          "--network",
          "none",
          "--read-only",
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--mount",
          `type=volume,source=${volume},target=/fixture`,
          "--entrypoint",
          "node",
          image,
          "-e",
          "const fs = require('node:fs'); for (const [name, text] of Object.entries(JSON.parse(fs.readFileSync(0, 'utf8')))) fs.writeFileSync('/fixture/' + name, text, {mode: 0o644});",
        ],
        { input: JSON.stringify(fixture.files) },
      );
      const environment = {
        HOMEPAGE_AUTH_ENABLED: "true",
        HOMEPAGE_AUTH_PASSWORD: password,
        HOMEPAGE_AUTH_SECRET: secret,
        HOMEPAGE_EXTERNAL_URL: canonical,
        HOMEPAGE_ALLOWED_HOSTS: host,
        NEXT_TELEMETRY_DISABLED: "1",
        HOSTNAME: "0.0.0.0",
        PORT: "3000",
        LOG_TARGETS: "stdout",
        PUID: String(uid),
        PGID: String(gid),
      };
      tool(
        [
          "create",
          "--name",
          name,
          "--label",
          `${ownerLabel}=${owner}`,
          "--platform",
          `linux/${arch}`,
          "--network",
          "bridge",
          "--publish",
          "127.0.0.1::3000",
          "--cap-drop=ALL",
          "--cap-add=CHOWN",
          "--cap-add=DAC_OVERRIDE",
          "--cap-add=FOWNER",
          "--cap-add=SETUID",
          "--cap-add=SETGID",
          "--security-opt=no-new-privileges",
          "--memory=1g",
          "--pids-limit=256",
          "--mount",
          `type=volume,source=${volume},target=${mount}`,
          "--env-file=/dev/stdin",
          image,
        ],
        {
          input:
            Object.entries(environment)
              .map(([key, value]) => `${key}=${value}`)
              .join("\n") + "\n",
        },
      );
      tool(["start", name]);
      let healthy = false;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const state = parseMetadata(tool(["inspect", "--format", "{{json .State}}", name]));
        requireRelease(
          state.Running && ["starting", "healthy"].includes(state.Health?.Status),
          "SMOKE_CONTAINER_UNHEALTHY",
        );
        if (state.Health.Status === "healthy") {
          healthy = true;
          break;
        }
        await pause(2000);
      }
      requireRelease(healthy, "SMOKE_CONTAINER_START_TIMEOUT");
      const port = tool(["port", name, "3000/tcp"]).trim();
      requireRelease(/^127\.0\.0\.1:[1-9]\d{0,4}$/.test(port), "SMOKE_PORT_NOT_LOOPBACK");
      const runtimeCheck = `
        const fs = require('node:fs');
        const status = fs.readFileSync('/proc/1/status', 'utf8');
        for (const [field, expected] of [['Uid', ${uid}], ['Gid', ${gid}]]) {
          const values = status.match(new RegExp('^' + field + ':\\\\s+(.+)$', 'm'))?.[1].trim().split(/\\s+/).map(Number);
          if (!values || values.length !== 4 || values.some(value => value !== expected)) throw Error('Wrong server identity');
        }
        if (process.arch !== '${arch === "amd64" ? "x64" : "arm64"}' || process.getuid() !== ${uid} || process.getgid() !== ${gid}) throw Error('Wrong runtime identity');
        if (fs.realpathSync('/app/config') !== '${mount}') throw Error('Wrong config mount');
        for (const [name, text] of Object.entries(${JSON.stringify(fixture.files)})) if (fs.readFileSync('/app/config/' + name, 'utf8') !== text) throw Error('Config changed or not mounted');
        fs.writeFileSync('/app/config/smoke-write-probe', 'writable');
        if (fs.readFileSync('/app/config/smoke-write-probe', 'utf8') !== 'writable') throw Error('Config not writable');
        fs.unlinkSync('/app/config/smoke-write-probe');
        process.stdout.write(fs.readFileSync('/app/.next/BUILD_ID', 'utf8').trim());
      `;
      const exec = ["exec", "--user", `${uid}:${gid}`, name, "node", "-e", runtimeCheck];
      const buildId = tool(exec).trim();
      const checks = await probe(`http://${port}`, fixture, password, buildId);
      requireRelease(tool(exec).trim() === buildId, "SMOKE_CONFIG_CHANGED_AFTER_HTTP");
      results.push({ platform: `linux/${arch}`, mount, uid, gid, checks, healthy: true });
    } finally {
      cleanup(tool, owner, name, volume);
    }
  }
  return results;
}
