// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useLayoutEffect } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NetworkProvider, useNetwork } from "./network";

import { normalizeServiceAddresses } from "utils/network/config";
import { NETWORK_PREFERENCE_KEY } from "utils/network/storage";

const config = (defaultMode = "default", modes = ["lan", "vpn"], enabled = true) => ({
  extensions: { network: { enabled, defaultMode, modes: modes.map((id) => ({ id, label: id.toUpperCase() })) } },
});
const preference = (mode) => JSON.stringify({ version: 1, mode });
let current;

function Probe({ onRender = () => {}, beforeRestore }) {
  const value = useNetwork();
  onRender(value);
  useLayoutEffect(() => {
    current = value;
    // Test the child commit before the Provider subscription, never queue a switch.
    if (!value.ready) beforeRestore?.(value);
  }, [beforeRestore, value]);
  return (
    <>
      <output data-testid="state">
        {value.mode}:{String(value.ready)}
      </output>
      <button type="button" onClick={() => value.setMode("lan")}>
        LAN
      </button>
      <button type="button" onClick={() => value.setMode("vpn")}>
        VPN
      </button>
    </>
  );
}

function mount(settings, props = {}) {
  return render(
    <NetworkProvider initialSettings={settings}>
      <Probe {...props} />
    </NetworkProvider>,
  );
}

function storageEvent(newValue, { key = NETWORK_PREFERENCE_KEY, storageArea = window.localStorage } = {}) {
  act(() => window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea })));
}

beforeEach(() => {
  current = null;
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("NetworkProvider restoration (STO-02/03, T15-T19)", () => {
  it("returns a ready disabled default without a Provider", () => {
    const read = vi.spyOn(Storage.prototype, "getItem");
    const write = vi.spyOn(Storage.prototype, "setItem");
    render(<Probe />);
    expect(current.settings.enabled).toBe(false);
    expect(current.mode).toBe("default");
    expect(current.ready).toBe(true);
    expect(current.setMode("lan")).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("uses the config default on the first render and restores a valid preference without writing", () => {
    localStorage.setItem(NETWORK_PREFERENCE_KEY, preference("lan"));
    const read = vi.spyOn(Storage.prototype, "getItem");
    const write = vi.spyOn(Storage.prototype, "setItem");
    const remove = vi.spyOn(Storage.prototype, "removeItem");
    const frames = [];
    mount(config("vpn"), { onRender: ({ mode, ready }) => frames.push({ mode, ready }) });
    expect(frames[0]).toEqual({ mode: "vpn", ready: false });
    expect(current.mode).toBe("lan");
    expect(current.ready).toBe(true);
    expect(read).toHaveBeenCalledWith(NETWORK_PREFERENCE_KEY);
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("uses defaultMode when no preference exists and only writes on an explicit valid switch", () => {
    const write = vi.spyOn(Storage.prototype, "setItem");
    mount(config("vpn"));
    expect(screen.getByTestId("state")).toHaveTextContent("vpn:true");
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "LAN" }));
    expect(screen.getByTestId("state")).toHaveTextContent("lan:true");
    expect(write).toHaveBeenCalledExactlyOnceWith(NETWORK_PREFERENCE_KEY, preference("lan"));
  });

  it("persists an explicit default selection instead of treating it as no preference", () => {
    const view = mount(config("vpn"));
    act(() => expect(current.setMode("default")).toBe(true));
    expect(current.mode).toBe("default");
    expect(localStorage.getItem(NETWORK_PREFERENCE_KEY)).toBe(preference("default"));
    view.rerender(
      <NetworkProvider initialSettings={config("lan")}>
        <Probe />
      </NetworkProvider>,
    );
    expect(current.mode).toBe("default");
  });

  it.each([
    null,
    "",
    "{broken",
    "null",
    "[]",
    '{"version":2,"mode":"lan"}',
    '{"version":1}',
    preference("removed"),
    preference("constructor"),
    preference(" LAN "),
  ])("falls back without replacing invalid preference: %j", (saved) => {
    if (saved !== null) localStorage.setItem(NETWORK_PREFERENCE_KEY, saved);
    const write = vi.spyOn(Storage.prototype, "setItem");
    const remove = vi.spyOn(Storage.prototype, "removeItem");
    mount(config("vpn"));
    expect(current.mode).toBe("vpn");
    expect(current.ready).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(localStorage.getItem(NETWORK_PREFERENCE_KEY)).toBe(saved);
  });

  it.each([undefined, {}, config("lan", ["lan"], false), { extensions: { network: "invalid" } }])(
    "never accesses storage or adds a storage listener while disabled: %j",
    (settings) => {
      const read = vi.spyOn(Storage.prototype, "getItem");
      const write = vi.spyOn(Storage.prototype, "setItem");
      const remove = vi.spyOn(Storage.prototype, "removeItem");
      const listen = vi.spyOn(window, "addEventListener");
      mount(settings);
      expect(current.settings.enabled).toBe(false);
      expect(current.ready).toBe(true);
      expect(current.setMode("default")).toBe(false);
      expect(read).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(listen.mock.calls.filter(([event]) => event === "storage")).toEqual([]);
    },
  );

  it("ends restoration after read failures and permits memory-only switching after write failures", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("read denied");
    });
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    mount(config("vpn"));
    expect(current.mode).toBe("vpn");
    expect(current.ready).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "LAN" }));
    expect(current.mode).toBe("lan");
    expect(write).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "VPN" }));
    expect(current.mode).toBe("vpn");
  });

  it("tolerates a throwing storage getter and ignores unidentifiable storage events", () => {
    const getter = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked site data");
    });
    mount(config("vpn"));
    expect(current.ready).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "LAN" }));
    expect(current.mode).toBe("lan");
    act(() =>
      window.dispatchEvent(new StorageEvent("storage", { key: NETWORK_PREFERENCE_KEY, newValue: preference("vpn") })),
    );
    expect(current.mode).toBe("lan");
    getter.mockRestore();
  });

  it("rejects invalid switches and refuses to queue a switch before ready", () => {
    localStorage.setItem(NETWORK_PREFERENCE_KEY, preference("lan"));
    const early = vi.fn();
    const write = vi.spyOn(Storage.prototype, "setItem");
    mount(config(), { beforeRestore: (value) => early(value.setMode("vpn")) });
    expect(early).toHaveBeenCalledWith(false);
    expect(current.mode).toBe("lan");
    for (const invalid of [undefined, null, "deleted", "constructor", "__proto__", 1, {}, " LAN "]) {
      expect(current.setMode(invalid)).toBe(false);
    }
    expect(current.mode).toBe("lan");
    expect(write).not.toHaveBeenCalled();
  });

  it("supports a valid network with only the built-in default mode", () => {
    mount({ extensions: { network: {} } });
    expect(current.mode).toBe("default");
    expect(current.ready).toBe(true);
    expect(current.settings.modes).toEqual([{ id: "default", label: null }]);
  });

  it("has identical SSR and hydration first frames without reading a browser API during render", async () => {
    localStorage.setItem(NETWORK_PREFERENCE_KEY, preference("lan"));
    const read = vi.spyOn(Storage.prototype, "getItem");
    const write = vi.spyOn(Storage.prototype, "setItem");
    const getter = vi.spyOn(window, "localStorage", "get");
    const frames = [];
    const props = { onRender: ({ mode, ready }) => frames.push({ mode, ready }) };
    const ui = (
      <NetworkProvider initialSettings={config("vpn")}>
        <Probe {...props} />
      </NetworkProvider>
    );
    const html = renderToString(ui);
    expect(frames).toEqual([{ mode: "vpn", ready: false }]);
    expect(read).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
    const container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = html;
    const recoverable = vi.fn();
    let root;
    try {
      await act(async () => {
        root = hydrateRoot(container, ui, { onRecoverableError: recoverable });
      });
      expect(frames[1]).toEqual(frames[0]);
      expect(current.mode).toBe("lan");
      expect(current.ready).toBe(true);
      expect(recoverable).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    } finally {
      if (root) await act(async () => root.unmount());
      container.remove();
    }
  });

  it("provides ready for a consumer to guard only expandable navigation (not a card UI acceptance test)", () => {
    const expandable = {
      href: "https://default.example.invalid",
      extensions: { network: { addresses: { lan: "http://lan.example.invalid" } } },
    };
    function NavigationContractProbe() {
      const value = useNetwork();
      const eligible = normalizeServiceAddresses(expandable, value.settings).eligible;
      return (
        <>
          <a href={!value.ready && eligible ? undefined : expandable.href}>Expandable</a>
          <a href="/legacy">Legacy</a>
        </>
      );
    }
    const html = renderToString(
      <NetworkProvider initialSettings={config()}>
        <NavigationContractProbe />
      </NetworkProvider>,
    );
    expect(html).toContain("<a>Expandable</a>");
    expect(html).toContain('<a href="/legacy">Legacy</a>');
  });

  it("cleans up StrictMode subscriptions and restores after a real remount without overwriting storage", () => {
    localStorage.setItem(NETWORK_PREFERENCE_KEY, preference("lan"));
    const listen = vi.spyOn(window, "addEventListener");
    const unlisten = vi.spyOn(window, "removeEventListener");
    const write = vi.spyOn(Storage.prototype, "setItem");
    const view = render(
      <StrictMode>
        <NetworkProvider initialSettings={config("vpn")}>
          <Probe />
        </NetworkProvider>
      </StrictMode>,
    );
    expect(current.mode).toBe("lan");
    expect(current.ready).toBe(true);
    const adds = listen.mock.calls.filter(([event]) => event === "storage");
    const removes = unlisten.mock.calls.filter(([event]) => event === "storage");
    expect(adds.length - removes.length).toBe(1);
    expect(write).not.toHaveBeenCalled();
    view.unmount();
    for (const [, listener] of adds) expect(unlisten).toHaveBeenCalledWith("storage", listener);
    const frames = [];
    mount(config("vpn"), { onRender: ({ mode, ready }) => frames.push({ mode, ready }) });
    expect(frames[0]).toEqual({ mode: "vpn", ready: false });
    expect(current.mode).toBe("lan");
    expect(write).not.toHaveBeenCalled();
  });
});

describe("NetworkProvider storage events and config updates (STO-04, T20)", () => {
  it("updates from other tabs, but not unrelated keys, sessionStorage or unidentified storage", () => {
    const write = vi.spyOn(Storage.prototype, "setItem");
    mount(config("vpn"));
    storageEvent(preference("lan"));
    expect(current.mode).toBe("lan");
    storageEvent(preference("vpn"), { key: "unrelated" });
    storageEvent(preference("vpn"), { storageArea: sessionStorage });
    storageEvent(preference("vpn"), { storageArea: null });
    expect(current.mode).toBe("lan");
    expect(write).not.toHaveBeenCalled();
  });

  it.each([null, "{broken", preference("deleted"), '{"version":2,"mode":"lan"}'])(
    "falls back for a deleted/invalid preference event without a feedback write: %j",
    (value) => {
      const write = vi.spyOn(Storage.prototype, "setItem");
      mount(config("vpn"));
      storageEvent(preference("lan"));
      storageEvent(value);
      expect(current.mode).toBe("vpn");
      expect(current.ready).toBe(true);
      expect(write).not.toHaveBeenCalled();
    },
  );

  it("uses the configuration default after localStorage.clear", () => {
    mount(config("vpn"));
    storageEvent(preference("lan"));
    storageEvent(null, { key: null });
    expect(current.mode).toBe("vpn");
  });

  it("keeps valid preference when defaultMode or labels change, without reading/writing storage again", () => {
    localStorage.setItem(NETWORK_PREFERENCE_KEY, preference("lan"));
    const read = vi.spyOn(Storage.prototype, "getItem");
    const write = vi.spyOn(Storage.prototype, "setItem");
    const view = mount(config());
    const count = read.mock.calls.length;
    const changed = config("vpn");
    changed.extensions.network.modes[0].label = "New LAN label";
    view.rerender(
      <NetworkProvider initialSettings={changed}>
        <Probe />
      </NetworkProvider>,
    );
    expect(current.mode).toBe("lan");
    expect(current.settings.modes[1].label).toBe("New LAN label");
    expect(read).toHaveBeenCalledTimes(count);
    expect(write).not.toHaveBeenCalled();
  });

  it("tracks config defaultMode changes if no valid local preference exists", () => {
    const view = mount(config());
    expect(current.mode).toBe("default");
    view.rerender(
      <NetworkProvider initialSettings={config("vpn")}>
        <Probe />
      </NetworkProvider>,
    );
    expect(current.mode).toBe("vpn");
    storageEvent(preference("deleted"));
    view.rerender(
      <NetworkProvider initialSettings={config("lan")}>
        <Probe />
      </NetworkProvider>,
    );
    expect(current.mode).toBe("lan");
  });

  it("immediately removes an invalid current mode on configuration changes without a stale render", () => {
    localStorage.setItem(NETWORK_PREFERENCE_KEY, preference("lan"));
    const write = vi.spyOn(Storage.prototype, "setItem");
    const view = mount(config());
    const frames = [];
    view.rerender(
      <NetworkProvider initialSettings={config("vpn", ["vpn"])}>
        <Probe onRender={({ mode, ready }) => frames.push({ mode, ready })} />
      </NetworkProvider>,
    );
    expect(frames[0]).toEqual({ mode: "vpn", ready: true });
    expect(current.mode).toBe("vpn");
    expect(write).not.toHaveBeenCalled();
    expect(localStorage.getItem(NETWORK_PREFERENCE_KEY)).toBe(preference("lan"));
  });

  it("does not reset memory selection if storage writes fail and settings are refreshed", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const view = mount(config());
    fireEvent.click(screen.getByRole("button", { name: "LAN" }));
    view.rerender(
      <NetworkProvider initialSettings={config("vpn")}>
        <Probe />
      </NetworkProvider>,
    );
    expect(current.mode).toBe("lan");
  });

  it("disables without clearing preference, ignores events while off, and restores afresh on re-enable", () => {
    localStorage.setItem(NETWORK_PREFERENCE_KEY, preference("lan"));
    const read = vi.spyOn(Storage.prototype, "getItem");
    const remove = vi.spyOn(Storage.prototype, "removeItem");
    const view = mount(config());
    view.rerender(
      <NetworkProvider initialSettings={config("vpn", ["lan", "vpn"], false)}>
        <Probe />
      </NetworkProvider>,
    );
    expect(current.settings.enabled).toBe(false);
    expect(current.mode).toBe("default");
    expect(current.ready).toBe(true);
    const count = read.mock.calls.length;
    storageEvent(preference("vpn"));
    expect(current.mode).toBe("default");
    expect(current.setMode("lan")).toBe(false);
    expect(read).toHaveBeenCalledTimes(count);
    expect(remove).not.toHaveBeenCalled();
    expect(localStorage.getItem(NETWORK_PREFERENCE_KEY)).toBe(preference("lan"));
    localStorage.setItem(NETWORK_PREFERENCE_KEY, preference("vpn"));
    const frames = [];
    view.rerender(
      <NetworkProvider initialSettings={config()}>
        <Probe onRender={({ mode, ready }) => frames.push({ mode, ready })} />
      </NetworkProvider>,
    );
    expect(frames[0]).toEqual({ mode: "default", ready: false });
    expect(current.mode).toBe("vpn");
    expect(current.ready).toBe(true);
  });

  it("isolates state across Provider instances instead of sharing a module-level mode", () => {
    const values = {};
    function SeparateProbe({ id }) {
      const value = useNetwork();
      useLayoutEffect(() => {
        values[id] = value;
      }, [id, value]);
      return null;
    }
    render(
      <>
        <NetworkProvider initialSettings={config()}>
          <SeparateProbe id="one" />
        </NetworkProvider>
        <NetworkProvider initialSettings={config("vpn")}>
          <SeparateProbe id="two" />
        </NetworkProvider>
      </>,
    );
    act(() => values.one.setMode("lan"));
    expect(values.one.mode).toBe("lan");
    expect(values.two.mode).toBe("vpn");
  });

  it("never mutates frozen initialSettings", () => {
    function freeze(value) {
      Object.values(value).forEach((child) => {
        if (child && typeof child === "object") freeze(child);
      });
      return Object.freeze(value);
    }
    const input = freeze(config());
    const before = JSON.stringify(input);
    mount(input);
    fireEvent.click(screen.getByRole("button", { name: "LAN" }));
    storageEvent(preference("vpn"));
    expect(JSON.stringify(input)).toBe(before);
  });
});
