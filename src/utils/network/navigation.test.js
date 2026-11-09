import { describe, expect, it } from "vitest";

import { normalizeNetworkSettings } from "./config";
import { getServiceNavigation, getServiceSearchEntry } from "./navigation";

const settings = normalizeNetworkSettings({
  extensions: {
    network: {
      modes: [
        { id: "lan", label: "LAN" },
        { id: "vpn", label: "VPN" },
      ],
    },
  },
});
const service = Object.freeze({
  name: "Network App",
  type: "service",
  href: "https://default.example.invalid/Case",
  target: "_self",
  extensions: Object.freeze({
    network: Object.freeze({ addresses: Object.freeze({ lan: "http://lan.example.invalid:8080/Case?q=2#Part" }) }),
  }),
  widget: Object.freeze({ url: "https://widget.example.invalid", key: "fictional-only" }),
});

describe("network UI navigation adapter", () => {
  it("suppresses only expandable links before ready without changing resolver/source data", () => {
    const network = { settings, mode: "default", ready: false };
    expect(getServiceNavigation(service, network)).toMatchObject({
      eligible: true,
      pending: true,
      href: undefined,
      hasLink: false,
      requestedMode: "default",
    });
    expect(getServiceNavigation({ href: "/legacy" }, network)).toMatchObject({
      eligible: false,
      pending: false,
      href: "/legacy",
      hasLink: true,
    });
    expect(service.href).toBe("https://default.example.invalid/Case");
  });

  it("uses identical current/fallback hrefs for card navigation and derived search", () => {
    for (const mode of ["default", "lan", "vpn"]) {
      const network = { settings, mode, ready: true };
      expect(getServiceSearchEntry(service, network).href).toBe(getServiceNavigation(service, network).href);
    }
    expect(getServiceNavigation(service, { settings, mode: "vpn", ready: true })).toMatchObject({
      href: service.href,
      fallback: true,
      resolvedMode: "default",
    });
  });

  it("creates immutable search entries from the raw service without losing metadata or Widget references", () => {
    const entry = getServiceSearchEntry(service, { settings, mode: "lan", ready: true });
    expect(entry).not.toBe(service);
    expect(entry.href).toBe(service.extensions.network.addresses.lan);
    expect(entry).toMatchObject({ name: service.name, type: service.type, target: service.target });
    expect(entry.widget).toBe(service.widget);
    expect(entry.extensions).toBe(service.extensions);
    expect(service.href).toBe("https://default.example.invalid/Case");
    expect(getServiceSearchEntry(service, { settings, mode: "lan", ready: false }).href).toBeUndefined();
  });

  it("preserves unextended entries and disabled-extension semantics", () => {
    const old = Object.freeze({ href: "custom:legacy", name: "Old" });
    expect(getServiceSearchEntry(old, { settings, mode: "lan", ready: false })).toBe(old);
    const disabled = { settings: normalizeNetworkSettings({}), mode: "default", ready: true };
    expect(getServiceSearchEntry(service, disabled)).toBe(service);
    expect(getServiceNavigation(service, disabled)).toMatchObject({
      href: service.href,
      pending: false,
      hasLink: true,
    });
  });

  it.each(["#", "", undefined])("does not add a new navigation route to an ineligible default href: %j", (href) => {
    const item = { ...service, href };
    const network = { settings, mode: "lan", ready: false };
    expect(getServiceNavigation(item, network)).toMatchObject({
      href,
      eligible: false,
      pending: false,
      hasLink: false,
    });
    expect(getServiceSearchEntry(item, network)).toBe(item);
  });
});
