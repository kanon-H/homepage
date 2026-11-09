import { describe, expect, it, vi } from "vitest";

import { normalizeNetworkSettings } from "./config";
import { getServiceAddressOptions, resolveServiceLink } from "./resolver";

const raw = {
  extensions: {
    network: {
      defaultMode: "lan",
      modes: [
        { id: "vpn", label: "VPN" },
        { id: "lan", label: "LAN" },
        { id: "office", label: "Office" },
      ],
    },
  },
};
const settings = normalizeNetworkSettings(raw);
const service = {
  name: "Fictional",
  href: " https://default.example.invalid/Case ",
  target: "_self",
  type: "service",
  extensions: {
    network: {
      addresses: { lan: "http://lan.example.invalid:8080/Case?x=2#Part", vpn: "https://vpn.example.invalid" },
    },
  },
  widget: { url: "http://widget.example.invalid", key: "fictional-only" },
};

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe("resolveServiceLink (RES-01/03, T07/T08/T12/T14)", () => {
  it("resolves each configured mode without changing default href", () => {
    expect(resolveServiceLink(service, settings, "lan")).toEqual({
      href: service.extensions.network.addresses.lan,
      requestedMode: "lan",
      resolvedMode: "lan",
      fallback: false,
      hasLink: true,
    });
    expect(resolveServiceLink(service, settings, "vpn").href).toBe(service.extensions.network.addresses.vpn);
    expect(resolveServiceLink(service, settings, "default")).toEqual({
      href: service.href,
      requestedMode: "default",
      resolvedMode: "default",
      fallback: false,
      hasLink: true,
    });
  });

  it("falls back to the untouched href if a mode has no valid candidate", () => {
    expect(resolveServiceLink(service, settings, "office")).toEqual({
      href: service.href,
      requestedMode: "office",
      resolvedMode: "default",
      fallback: true,
      hasLink: true,
    });
    const broken = {
      ...service,
      extensions: { network: { addresses: { lan: "javascript:bad", vpn: "https://vpn.example.invalid" } } },
    };
    expect(resolveServiceLink(broken, settings, "lan")).toMatchObject({
      href: service.href,
      fallback: true,
      resolvedMode: "default",
    });
    expect(resolveServiceLink({ href: "/legacy" }, settings, "lan")).toMatchObject({ href: "/legacy", fallback: true });
  });

  it.each([undefined, "deleted", "constructor", "__proto__", null, " LAN "])(
    "corrects invalid mode %j to configuration defaultMode",
    (mode) => {
      expect(resolveServiceLink(service, settings, mode)).toMatchObject({ requestedMode: "lan", resolvedMode: "lan" });
    },
  );

  it("does not apply alternate addresses when globally disabled or missing", () => {
    for (const disabled of [
      normalizeNetworkSettings({}),
      normalizeNetworkSettings({ extensions: { network: { enabled: false } } }),
    ]) {
      expect(resolveServiceLink(service, disabled, "lan")).toEqual({
        href: service.href,
        requestedMode: "default",
        resolvedMode: "default",
        fallback: false,
        hasLink: true,
      });
      expect(getServiceAddressOptions(service, disabled, "lan")).toEqual([]);
    }
  });

  it.each([undefined, null, "", "   ", "#", " # ", 1])(
    "preserves upstream hasLink semantics without enabling an ineligible service: %j",
    (href) => {
      const input = { ...service, href };
      expect(resolveServiceLink(input, settings, "lan")).toMatchObject({
        href,
        resolvedMode: "default",
        fallback: false,
        hasLink: Boolean(href && href !== "#"),
      });
      expect(getServiceAddressOptions(input, settings, "lan")).toEqual([]);
    },
  );

  it.each(["/relative", "mailto:old@example.invalid", "custom:legacy", "javascript:legacy"])(
    "preserves old protocol/path when extension is absent: %s",
    (href) => {
      expect(resolveServiceLink({ href }, settings, "default").href).toBe(href);
      expect(resolveServiceLink({ href }, normalizeNetworkSettings({}), "lan").href).toBe(href);
    },
  );

  it("is immutable and independent of browser APIs or logging", () => {
    const input = freeze(structuredClone(service));
    const config = freeze(structuredClone(settings));
    const warn = vi.spyOn(console, "warn");
    const windowAccess = vi.fn(() => {
      throw new Error("browser access forbidden");
    });
    vi.stubGlobal("window", {
      get localStorage() {
        return windowAccess();
      },
    });
    try {
      const result = resolveServiceLink(input, config, "lan");
      const derived = { ...input, href: result.href };
      expect(derived.href).toBe(service.extensions.network.addresses.lan);
      expect(input.href).toBe(service.href);
      expect(input.widget).toEqual(service.widget);
      expect(derived.widget).toBe(input.widget);
      expect(derived.target).toBe("_self");
      expect(derived.type).toBe("service");
      getServiceAddressOptions(input, config, "lan");
      expect(windowAccess).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      warn.mockRestore();
    }
  });
});

describe("getServiceAddressOptions (UI-03 data only)", () => {
  it("orders default first then configured modes, marks source, and omits missing candidates", () => {
    expect(getServiceAddressOptions(service, settings, "lan")).toEqual([
      { id: "default", label: null, href: service.href, current: false },
      { id: "vpn", label: "VPN", href: service.extensions.network.addresses.vpn, current: false },
      { id: "lan", label: "LAN", href: service.extensions.network.addresses.lan, current: true },
    ]);
    const options = getServiceAddressOptions(service, settings, "office");
    expect(options.filter((option) => option.current).map((option) => option.id)).toEqual(["default"]);
  });

  it("preserves separate mode semantics for identical URLs without duplicate current items", () => {
    const same = {
      ...service,
      extensions: { network: { addresses: { lan: service.href.trim(), vpn: service.href.trim() } } },
    };
    const options = getServiceAddressOptions(same, settings, "vpn");
    expect(options.map((option) => option.id)).toEqual(["default", "vpn", "lan"]);
    expect(options.filter((option) => option.current).map((option) => option.id)).toEqual(["vpn"]);
  });

  it("does not offer a menu without a valid alternate or valid default", () => {
    expect(getServiceAddressOptions({ href: "/old" }, settings, "lan")).toEqual([]);
    expect(getServiceAddressOptions({ ...service, href: "#" }, settings, "lan")).toEqual([]);
    expect(
      getServiceAddressOptions(
        { ...service, extensions: { network: { addresses: { lan: "file:///bad" } } } },
        settings,
        "lan",
      ),
    ).toEqual([]);
  });
});
