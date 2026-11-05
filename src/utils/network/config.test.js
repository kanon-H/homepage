import { describe, expect, it } from "vitest";

import { normalizeNetworkServiceGroups, normalizeNetworkSettings, normalizeServiceAddresses } from "./config";

const rawSettings = (network) => ({ extensions: { network } });
const enabled = normalizeNetworkSettings(
  rawSettings({
    modes: [
      { id: "lan", label: "内网" },
      { id: "vpn", label: "VPN" },
    ],
  }),
);
const service = (addresses, href = "https://default.example.invalid/Path") => ({
  href,
  extensions: { network: { addresses } },
});

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe("normalizeNetworkSettings (CFG-01/02, T01-T06)", () => {
  it.each([undefined, null, {}, { extensions: {} }, { extensions: { other: {} } }])(
    "is disabled without an own network field: %j",
    (value) => {
      expect(normalizeNetworkSettings(value)).toEqual({
        enabled: false,
        defaultMode: "default",
        modes: [{ id: "default", label: null }],
        diagnostics: [],
      });
    },
  );

  it.each([null, [], "network", 1, false, new Date()])("disables malformed network: %j", (value) => {
    expect(normalizeNetworkSettings(rawSettings(value))).toMatchObject({
      enabled: false,
      diagnostics: [{ code: "invalid-network" }],
    });
  });

  it.each(["false", 0, null, undefined])("does not coerce enabled: %j", (value) => {
    expect(normalizeNetworkSettings(rawSettings({ enabled: value }))).toMatchObject({
      enabled: false,
      diagnostics: [{ code: "invalid-enabled" }],
    });
  });

  it("explicitly disables without interpreting other invalid fields", () => {
    expect(normalizeNetworkSettings(rawSettings({ enabled: false, modes: "invalid" }))).toMatchObject({
      enabled: false,
      diagnostics: [],
    });
  });

  it.each([{}, null, "lan", 3, undefined])("rejects a non-array modes field: %j", (modes) => {
    expect(normalizeNetworkSettings(rawSettings({ modes }))).toMatchObject({
      enabled: false,
      diagnostics: [{ code: "invalid-modes" }],
    });
  });

  it.each([{}, { modes: [] }])("enables a valid object with just the built-in mode: %j", (network) => {
    expect(normalizeNetworkSettings(rawSettings(network))).toMatchObject({
      enabled: true,
      modes: [{ id: "default", label: null }],
      diagnostics: [],
    });
  });

  it("inserts default first, trims labels, preserves order, and uses a configured default", () => {
    const input = freeze(
      rawSettings({
        defaultMode: "vpn",
        modes: [
          { id: "vpn", label: " VPN " },
          { id: "default", label: "默认" },
          { id: "lan", label: "内网" },
        ],
        future: "ignored",
      }),
    );
    expect(normalizeNetworkSettings(input)).toEqual({
      enabled: true,
      defaultMode: "vpn",
      modes: [
        { id: "default", label: "默认" },
        { id: "vpn", label: "VPN" },
        { id: "lan", label: "内网" },
      ],
      diagnostics: [],
    });
  });

  it.each(["LAN", " lan", "lan ", "1lan", "", "a".repeat(33), "__proto__", "constructor", "prototype", null, 12])(
    "ignores invalid/reserved IDs: %j",
    (id) => {
      const result = normalizeNetworkSettings(
        rawSettings({
          modes: [
            { id, label: "label" },
            { id: "lan", label: "Valid" },
          ],
        }),
      );
      expect(result.modes.map((mode) => mode.id)).toEqual(["default", "lan"]);
      expect(result.diagnostics).toEqual([
        { path: "settings.extensions.network.modes[0].id", code: "invalid-mode-id" },
      ]);
    },
  );

  it("accepts the 32-character ID boundary and legal punctuation", () => {
    const id = "a" + "b".repeat(29) + "_-";
    expect(normalizeNetworkSettings(rawSettings({ modes: [{ id, label: "Valid" }] })).modes[1].id).toBe(id);
  });

  it.each([
    null,
    [],
    "mode",
    {},
    { id: "lan" },
    { id: "lan", label: 1 },
    { id: "lan", label: "  " },
    { id: "lan", label: "😀".repeat(65) },
  ])("ignores malformed modes: %j", (mode) => {
    expect(normalizeNetworkSettings(rawSettings({ modes: [mode] })).modes).toHaveLength(1);
  });

  it("counts label length in Unicode code points and keeps markup as text", () => {
    const label = "😀".repeat(64);
    expect(normalizeNetworkSettings(rawSettings({ modes: [{ id: "lan", label }] })).modes[1].label).toBe(label);
    expect(normalizeNetworkSettings(rawSettings({ modes: [{ id: "lan", label: "<b>LAN</b>" }] })).modes[1].label).toBe(
      "<b>LAN</b>",
    );
  });

  it("keeps the first legal duplicate, including default label declarations", () => {
    const result = normalizeNetworkSettings(
      rawSettings({
        modes: [
          { id: "lan", label: " " },
          { id: "lan", label: "First" },
          { id: "lan", label: "Second" },
          { id: "default", label: "Original" },
          { id: "default", label: "Other" },
        ],
      }),
    );
    expect(result.modes).toEqual([
      { id: "default", label: "Original" },
      { id: "lan", label: "First" },
    ]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["invalid-mode-label", "duplicate-mode", "duplicate-mode"]);
  });

  it.each(["deleted", "constructor", null, 1, " LAN "])("falls back only defaultMode for %j", (defaultMode) => {
    expect(normalizeNetworkSettings(rawSettings({ defaultMode, modes: [{ id: "lan", label: "LAN" }] }))).toMatchObject({
      enabled: true,
      defaultMode: "default",
      diagnostics: [{ code: "invalid-default-mode" }],
    });
  });

  it("ignores inherited configuration and does not mutate other namespaces", () => {
    expect(normalizeNetworkSettings(Object.create(rawSettings({}))).enabled).toBe(false);
    const input = freeze({ extensions: { other: { value: 1 }, network: { modes: [] } } });
    normalizeNetworkSettings(input);
    expect(input.extensions.other).toEqual({ value: 1 });
  });
});

describe("normalizeServiceAddresses (SVC-01/04, T09-T12)", () => {
  it.each([null, [], "broken", 1])("locally diagnoses malformed service network: %j", (network) => {
    expect(normalizeServiceAddresses({ href: "/old", extensions: { network } }, enabled)).toMatchObject({
      eligible: false,
      diagnostics: [{ code: "invalid-service-network" }],
    });
  });

  it.each([null, [], "broken", 1])("locally diagnoses malformed address mappings: %j", (addresses) => {
    expect(normalizeServiceAddresses(service(addresses), enabled)).toMatchObject({
      eligible: false,
      addresses: {},
      diagnostics: [{ code: "invalid-addresses" }],
    });
  });

  it("ignores absent extension/address fields and all fields while disabled", () => {
    expect(normalizeServiceAddresses({ href: "/old" }, enabled)).toEqual({
      eligible: false,
      addresses: {},
      diagnostics: [],
    });
    expect(normalizeServiceAddresses({ extensions: { network: {} } }, enabled).diagnostics).toEqual([]);
    expect(normalizeServiceAddresses(service("broken"), normalizeNetworkSettings({}))).toEqual({
      eligible: false,
      addresses: {},
      diagnostics: [],
    });
  });

  it.each([null, "", "   "])("treats empty candidate %j as unconfigured", (value) => {
    expect(normalizeServiceAddresses(service({ lan: value }), enabled)).toEqual({
      eligible: false,
      addresses: {},
      diagnostics: [],
    });
  });

  it.each([1, true, {}, [], undefined])("rejects non-string candidates: %j", (value) => {
    expect(normalizeServiceAddresses(service({ lan: value }), enabled)).toMatchObject({
      addresses: {},
      diagnostics: [{ code: "invalid-address-type" }],
    });
  });

  it.each([
    "javascript:alert(1)",
    "data:text/plain,test",
    "file:///tmp/test",
    "//lan.example.invalid",
    "/relative",
    "http:lan.example.invalid",
    "https://",
    "not a URL",
    "https://[invalid]/",
    "ftp://lan.example.invalid",
  ])("rejects unsafe/relative URLs: %s", (value) => {
    expect(normalizeServiceAddresses(service({ lan: value }), enabled)).toMatchObject({
      addresses: {},
      diagnostics: [{ code: "invalid-address-url" }],
    });
  });

  it.each([
    "http://user:pass@lan.example.invalid",
    "https://user@lan.example.invalid",
    "https://:pass@lan.example.invalid",
  ])("rejects credentials: %s", (value) => {
    expect(normalizeServiceAddresses(service({ lan: value }), enabled).diagnostics[0].code).toBe("address-credentials");
  });

  it.each(Array.from({ length: 33 }, (_, index) => String.fromCharCode(index === 32 ? 127 : index)))(
    "rejects control character %j before parsing or trimming",
    (control) => {
      expect(
        normalizeServiceAddresses(service({ lan: `${control}http://lan.example.invalid/` }), enabled).diagnostics[0]
          .code,
      ).toBe("address-control-character");
      expect(
        normalizeServiceAddresses(service({ lan: `http://lan.example.invalid/a${control}b` }), enabled).addresses,
      ).toEqual({});
    },
  );

  it.each([
    "http://192.168.1.10:5000/Path?q=A&b=2#Fragment",
    "http://[fd00::1]:8080/Case?X=1#Part",
    "https://nas.internal/Case",
    "HTTP://LAN.EXAMPLE.INVALID/Case",
    "https://host.example.invalid/%2f?a=2&a=1",
  ])("preserves valid URL text: %s", (href) => {
    expect(normalizeServiceAddresses(service({ lan: `  ${href}  ` }), enabled)).toEqual({
      eligible: true,
      addresses: { lan: href },
      diagnostics: [],
    });
  });

  it.each([undefined, null, 4, "", "   ", "#", " # "])("does not enable without a usable original href: %j", (href) => {
    const input = service({ lan: "http://lan.example.invalid" });
    input.href = href;
    expect(normalizeServiceAddresses(input, enabled).eligible).toBe(false);
  });

  it.each(["/relative", "mailto:test@example.invalid", "custom:legacy", " https://old.example.invalid/ "])(
    "does not tighten legacy href: %s",
    (href) => {
      expect(normalizeServiceAddresses(service({ lan: "http://lan.example.invalid" }, href), enabled).eligible).toBe(
        true,
      );
    },
  );

  it("ignores unknown/default/prototype keys, inherited addresses, and redacts diagnostics", () => {
    const addresses = JSON.parse(
      '{"__proto__":"http://bad.example.invalid","constructor":"sensitive","prototype":"sensitive","default":"sensitive","https://secret.example.invalid/token":"sensitive","lan":"javascript:sensitive"}',
    );
    const result = normalizeServiceAddresses(service(addresses), enabled);
    expect(result.addresses).toEqual({});
    expect(result.diagnostics).toHaveLength(6);
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/sensitive|secret|bad\.example|constructor|__proto__/);
    expect(
      normalizeServiceAddresses(service(Object.create({ lan: "http://inherited.example.invalid" })), enabled).addresses,
    ).toEqual({});
    expect({}.polluted).toBeUndefined();
  });

  it("accepts null-prototype mappings safely", () => {
    const addresses = Object.assign(Object.create(null), { lan: "http://lan.example.invalid" });
    expect(normalizeServiceAddresses(service(addresses), enabled).addresses).toEqual({
      lan: "http://lan.example.invalid",
    });
  });

  it("retains valid siblings and never mutates a frozen source", () => {
    const input = freeze(service({ lan: "http://lan.example.invalid", vpn: "javascript:bad" }));
    expect(normalizeServiceAddresses(input, freeze(enabled)).addresses).toEqual({ lan: "http://lan.example.invalid" });
    expect(input.extensions.network.addresses.vpn).toBe("javascript:bad");
  });
});

describe("normalizeNetworkServiceGroups (T13/T14)", () => {
  it("filters recursively without changing original href, widget, monitoring or unrelated extensions", () => {
    const item = {
      ...service({ lan: " http://lan.example.invalid ", vpn: "javascript:bad" }),
      widget: { url: "http://widget.example.invalid", key: "fixture-only" },
      ping: "monitor.example.invalid",
      siteMonitor: "http://monitor.example.invalid",
      extensions: {
        other: { enabled: true },
        ...service({ lan: " http://lan.example.invalid ", vpn: "javascript:bad" }).extensions,
      },
    };
    const groups = freeze([
      {
        name: "Root",
        services: [item],
        groups: [{ name: "Child", services: [item], groups: [{ name: "Deep", services: [item], groups: [] }] }],
      },
    ]);
    const result = normalizeNetworkServiceGroups(groups, freeze(enabled));
    const root = result.groups[0].services[0];
    expect(root.extensions.network.addresses).toEqual({ lan: "http://lan.example.invalid" });
    expect(root.extensions.other).toBe(item.extensions.other);
    expect(root.widget).toBe(item.widget);
    expect(root.href).toBe(item.href);
    expect(root.ping).toBe(item.ping);
    expect(root.siteMonitor).toBe(item.siteMonitor);
    expect(result.groups[0].groups[0].groups[0].services[0].extensions.network.addresses).toEqual(
      root.extensions.network.addresses,
    );
    expect(result.diagnostics.map((d) => d.path)).toEqual([
      "services[0].services[0].extensions.network.addresses[1]",
      "services[0].groups[0].services[0].extensions.network.addresses[1]",
      "services[0].groups[0].groups[0].services[0].extensions.network.addresses[1]",
    ]);
    expect(item.extensions.network.addresses.vpn).toBe("javascript:bad");
  });

  it("removes disabled/malformed network payloads without losing unrelated extensions", () => {
    const input = freeze([
      {
        name: "Root",
        services: [
          {
            ...service({ lan: "http://lan.example.invalid" }),
            extensions: { other: { value: 1 }, network: { addresses: { lan: "http://lan.example.invalid" } } },
          },
        ],
        groups: [],
      },
    ]);
    expect(normalizeNetworkServiceGroups(input, normalizeNetworkSettings({})).groups[0].services[0].extensions).toEqual(
      { other: { value: 1 } },
    );
    const malformed = [{ services: [{ href: "/old", extensions: { network: "invalid", other: true } }] }];
    expect(normalizeNetworkServiceGroups(malformed, enabled).groups[0].services[0].extensions).toEqual({ other: true });
  });
});
