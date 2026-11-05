import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NETWORK_PREFERENCE_KEY,
  parseNetworkPreference,
  readNetworkPreference,
  removeNetworkPreference,
  writeNetworkPreference,
} from "./storage";

const preference = JSON.stringify({ version: 1, mode: "lan" });
let storage;

beforeEach(() => {
  storage = { getItem: vi.fn(() => preference), setItem: vi.fn(), removeItem: vi.fn() };
  vi.stubGlobal("window", { localStorage: storage });
});
afterEach(() => vi.unstubAllGlobals());

describe("network preference storage (STO-01/02)", () => {
  it("uses the fixed key and serializes only version and mode", () => {
    expect(NETWORK_PREFERENCE_KEY).toBe("homepage.network.preference.v1");
    expect(readNetworkPreference()).toBe("lan");
    expect(storage.getItem).toHaveBeenCalledWith(NETWORK_PREFERENCE_KEY);
    expect(writeNetworkPreference("vpn")).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(NETWORK_PREFERENCE_KEY, '{"version":1,"mode":"vpn"}');
    expect(removeNetworkPreference()).toBe(true);
    expect(storage.removeItem).toHaveBeenCalledWith(NETWORK_PREFERENCE_KEY);
  });

  it.each([
    undefined,
    null,
    1,
    true,
    {},
    [],
    "",
    "{broken",
    "null",
    "[]",
    '"lan"',
    "1",
    "true",
    "{}",
    '{"version":2,"mode":"lan"}',
    '{"version":"1","mode":"lan"}',
    '{"version":1}',
    '{"mode":"lan"}',
    '{"version":1,"mode":null}',
    '{"version":1,"mode":3}',
    '{"version":1,"mode":{}}',
  ])("ignores malformed/unversioned preferences: %j", (value) => {
    expect(parseNetworkPreference(value)).toBeNull();
    storage.getItem.mockReturnValue(value);
    expect(readNetworkPreference()).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("parses strings without deciding whether a mode is defined, and ignores unknown fields", () => {
    expect(parseNetworkPreference('{"version":1,"mode":"deleted","unknown":true}')).toBe("deleted");
    expect(parseNetworkPreference('{"version":1,"mode":"constructor"}')).toBe("constructor");
  });

  it("handles an unavailable window without throwing", () => {
    vi.stubGlobal("window", undefined);
    expect(readNetworkPreference()).toBeNull();
    expect(writeNetworkPreference("lan")).toBe(false);
    expect(removeNetworkPreference()).toBe(false);
  });

  it("handles a throwing localStorage getter for every operation", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("blocked storage");
      },
    });
    expect(readNetworkPreference()).toBeNull();
    expect(writeNetworkPreference("lan")).toBe(false);
    expect(removeNetworkPreference()).toBe(false);
  });

  it("handles individual read, write and remove failures", () => {
    storage.getItem.mockImplementation(() => {
      throw new Error("read denied");
    });
    storage.setItem.mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    storage.removeItem.mockImplementation(() => {
      throw new Error("remove denied");
    });
    expect(readNetworkPreference()).toBeNull();
    expect(writeNetworkPreference("lan")).toBe(false);
    expect(removeNetworkPreference()).toBe(false);
  });

  it.each([undefined, null, 1, [], {}])("does not write non-string modes: %j", (mode) => {
    expect(writeNetworkPreference(mode)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
