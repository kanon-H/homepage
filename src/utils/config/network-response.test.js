import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import createMockRes from "test-utils/create-mock-res";

const state = vi.hoisted(() => ({
  files: {},
  settings: {},
  docker: [],
  kubernetes: [],
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("fs", async (importOriginal) => ({
  ...(await importOriginal()),
  promises: {
    readFile: vi.fn(async (filePath) => state.files[String(filePath).split("/").pop()] ?? "{}"),
  },
}));
vi.mock("utils/config/config", () => ({
  default: vi.fn(() => true),
  CONF_DIR: "/fictional-config",
  getSettings: vi.fn(() => state.settings),
  substituteEnvironmentVars: (value) => value,
}));
vi.mock("utils/config/service-helpers", async (importOriginal) => ({
  ...(await importOriginal()),
  servicesFromDocker: vi.fn(async () => structuredClone(state.docker)),
  servicesFromKubernetes: vi.fn(async () => structuredClone(state.kubernetes)),
}));
vi.mock("utils/config/kubernetes", () => ({ getKubeConfig: () => null }));
vi.mock("utils/kubernetes/export", () => ({ default: {} }));
vi.mock("utils/logger", () => ({ default: () => state.logger }));
vi.mock("next-i18next/pages/serverSideTranslations", () => ({ serverSideTranslations: vi.fn(async () => ({})) }));

import servicesHandler from "pages/api/services/index";
import { bookmarksResponse, servicesResponse } from "utils/config/api-response";
import { getDashboardData, invalidateDashboardData } from "utils/config/dashboard";
import { loadYaml } from "utils/config/yaml";
import { normalizeNetworkSettings } from "utils/network/config";
import { resolveServiceLink } from "utils/network/resolver";

const settingsYaml = `
extensions:
  untouched:
    value: preserved
  network:
    defaultMode: lan
    modes:
      - id: lan
        label: 内网
      - id: vpn
        label: VPN
`;
const servicesYaml = `
- Root:
    - Legacy:
        href: /legacy/path
    - Child:
        - Deep:
            - NetworkService:
                href: https://default.example.invalid/Case
                target: _self
                ping: monitor.example.invalid
                siteMonitor: https://monitor.example.invalid
                extensions:
                  other:
                    value: preserved
                  network:
                    addresses:
                      lan: " http://lan.example.invalid:8080/Case?a=2&a=1#Part "
                      vpn: javascript:invalid
                      default: https://ignored.example.invalid
                      unknown: https://ignored.example.invalid
                widget:
                  type: jellyfin
                  url: https://widget.example.invalid
                  key: fictional-widget-secret
`;

function nestedService(groups) {
  return groups[0].groups[0].groups[0].services[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateDashboardData();
  vi.stubEnv("HOMEPAGE_AUTH_ENABLED", "false");
  state.settings = loadYaml(settingsYaml);
  state.files = { "services.yaml": servicesYaml, "widgets.yaml": "[]", "bookmarks.yaml": "[]" };
  state.docker = [];
  state.kubernetes = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
});
afterEach(() => {
  invalidateDashboardData();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("network navigation service response boundary (real YAML + Widget cleaning)", () => {
  it("uses the same filtered payload for SSR and API, recursively preserving href and Widget secrecy", async () => {
    const rawSettings = structuredClone(state.settings);
    const dashboard = await getDashboardData();
    const response = createMockRes();
    await servicesHandler({ headers: { host: "localhost:3000" } }, response);
    expect(response.body).toEqual(dashboard.fallback["/api/services"]);
    const item = nestedService(response.body);
    expect(item.extensions.network.addresses).toEqual({ lan: "http://lan.example.invalid:8080/Case?a=2&a=1#Part" });
    expect(item.extensions.other).toEqual({ value: "preserved" });
    expect(item.href).toBe("https://default.example.invalid/Case");
    expect(item.type).toBe("service");
    expect(item.target).toBe("_self");
    expect(item.ping).toBe("monitor.example.invalid");
    expect(item.siteMonitor).toBe("https://monitor.example.invalid");
    expect(item.widgets).toEqual([
      {
        type: "jellyfin",
        index: 0,
        fields: null,
        hide_errors: false,
        service_name: "NetworkService",
        service_group: "Deep",
        version: null,
      },
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(
      /fictional-widget-secret|widget\.example|javascript:invalid|ignored\.example/,
    );
    expect(state.settings).toEqual(rawSettings);
    expect(state.files["services.yaml"]).toBe(servicesYaml);
    const settings = normalizeNetworkSettings(state.settings);
    expect(resolveServiceLink(item, settings, "lan").href).toBe(item.extensions.network.addresses.lan);
    expect(resolveServiceLink(item, settings, "vpn")).toMatchObject({ href: item.href, fallback: true });
    const again = await getDashboardData();
    expect(again).toBe(dashboard);
    expect(nestedService(again.fallback["/api/services"]).href).toBe(item.href);
  });

  it("keeps legacy Docker/Kubernetes discovery and applies the same rules to all sources", async () => {
    state.files["services.yaml"] = "[]";
    state.docker = [
      {
        name: "Discovered",
        services: [
          {
            name: "Docker",
            href: "/docker",
            weight: 1,
            extensions: { network: { addresses: { lan: "http://docker.example.invalid", vpn: "data:invalid" } } },
            widgets: [{ type: "jellyfin", url: "https://widget.example.invalid", key: "fictional-widget-secret" }],
          },
        ],
        groups: [],
      },
    ];
    state.kubernetes = [
      { name: "Discovered", services: [{ name: "Kubernetes", href: "/kube", weight: 2 }], groups: [] },
    ];
    const result = await servicesResponse();
    expect(result[0].services.map((item) => item.name)).toEqual(["Docker", "Kubernetes"]);
    expect(result[0].services[0].extensions.network.addresses).toEqual({ lan: "http://docker.example.invalid" });
    expect(result[0].services[1].href).toBe("/kube");
    expect(JSON.stringify(result)).not.toMatch(/fictional-widget-secret|data:invalid/);
    expect(state.docker[0].services[0].extensions.network.addresses.vpn).toBe("data:invalid");
  });

  it.each([{}, { extensions: { network: { enabled: false } } }, { extensions: { network: { modes: "invalid" } } }])(
    "does not activate service-only/disabled/invalid global configuration: %j",
    async (settings) => {
      state.settings = settings;
      const item = nestedService(await servicesResponse());
      expect(item.href).toBe("https://default.example.invalid/Case");
      expect(item.extensions).toEqual({ other: { value: "preserved" } });
      expect(item.widgets).toEqual([
        {
          type: "jellyfin",
          index: 0,
          fields: null,
          hide_errors: false,
          service_name: "NetworkService",
          service_group: "Deep",
          version: null,
        },
      ]);
    },
  );

  it("keeps pure upstream services semantically unchanged", async () => {
    state.settings = {};
    state.files["services.yaml"] = "- Root:\n    - Old:\n        href: custom:legacy\n        target: _self\n";
    const groups = await servicesResponse();
    expect(groups[0].services[0]).toEqual({
      name: "Old",
      href: "custom:legacy",
      target: "_self",
      type: "service",
      weight: 100,
      widgets: [],
    });
  });

  it("does not interpret bookmark network fields", async () => {
    state.files["bookmarks.yaml"] =
      "- Links:\n    - Bookmark:\n        - href: https://bookmark.example.invalid\n          extensions:\n            network:\n              addresses:\n                lan: http://bookmark-lan.example.invalid\n";
    const result = await bookmarksResponse();
    expect(result[0].bookmarks[0].href).toBe("https://bookmark.example.invalid");
    expect(result[0].bookmarks[0].extensions.network.addresses.lan).toBe("http://bookmark-lan.example.invalid");
  });
});
