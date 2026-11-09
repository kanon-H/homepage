import { afterEach, describe, expect, it, vi } from "vitest";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("utils/logger", () => ({ default: () => ({ warn }) }));

const settings = { extensions: { network: { modes: [{ id: "lan", label: "LAN" }] } } };
const groups = [
  {
    name: "https://untrusted.example.invalid/name",
    services: [
      {
        href: "/old",
        extensions: { network: { addresses: { lan: "http://user:password@private.example.invalid?token=fixture" } } },
      },
    ],
    groups: [],
  },
];

afterEach(() => vi.restoreAllMocks());

describe("server network diagnostics", () => {
  it("deduplicates unchanged warnings and never logs raw names, URLs, keys or credentials", async () => {
    vi.resetModules();
    warn.mockClear();
    const { filterNetworkServiceGroups } = await import("./server");
    const first = filterNetworkServiceGroups(groups, settings);
    expect(first[0].services[0].extensions.network.addresses).toEqual({});
    filterNetworkServiceGroups(groups, settings);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "Network navigation configuration warning: %s",
      "services[0].services[0].extensions.network.addresses[0]: address-credentials",
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/https?:|password|token|private|untrusted/);
    filterNetworkServiceGroups([], settings);
    filterNetworkServiceGroups(groups, settings);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("logs global configuration errors even without services, but ignores explicitly disabled fields", async () => {
    vi.resetModules();
    warn.mockClear();
    const { filterNetworkServiceGroups } = await import("./server");
    expect(filterNetworkServiceGroups([], { extensions: { network: { enabled: "false" } } })).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "Network navigation configuration warning: %s",
      "settings.extensions.network.enabled: invalid-enabled",
    );
    warn.mockClear();
    const result = filterNetworkServiceGroups(groups, { extensions: { network: { enabled: false } } });
    expect(warn).not.toHaveBeenCalled();
    expect(result[0].services[0].extensions).toEqual({});
  });
});
