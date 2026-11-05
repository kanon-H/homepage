// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createInstance } from "i18next";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../../public/locales/en/common.json";
import zh from "../../../public/locales/zh-Hans/common.json";

import ModeSwitcher from "components/network/mode-switcher";
import Item from "components/services/item";
import { NetworkProvider } from "utils/contexts/network";
import { SettingsContext } from "utils/contexts/settings";
import { NETWORK_PREFERENCE_KEY } from "utils/network/storage";

const state = vi.hoisted(() => ({ t: (key) => key, widgetClick: vi.fn() }));
vi.mock("next-i18next/pages", () => ({ useTranslation: () => ({ t: (key, options) => state.t(key, options) }) }));
vi.mock("components/resolvedicon", () => ({ default: () => <span>Icon</span> }));
vi.mock("components/services/widget", () => ({
  default: () => (
    <button type="button" data-testid="widget" onClick={state.widgetClick}>
      Widget interaction
    </button>
  ),
}));
vi.mock("widgets/docker/component", () => ({ default: () => <div data-testid="docker-stats">Docker statistics</div> }));
vi.mock("widgets/kubernetes/component", () => ({ default: () => null }));
vi.mock("widgets/proxmoxvm/component", () => ({ default: () => null }));
vi.mock("components/services/status", () => ({ default: () => <span>Docker status</span> }));
vi.mock("components/services/ping", () => ({ default: () => <span>Ping</span> }));
vi.mock("components/services/site-monitor", () => ({ default: () => <span>Monitor</span> }));
vi.mock("components/services/kubernetes-status", () => ({ default: () => null }));
vi.mock("components/services/proxmox-status", () => ({ default: () => null }));

const config = {
  extensions: {
    network: {
      modes: [
        { id: "lan", label: "LAN" },
        { id: "vpn", label: "VPN" },
        { id: "office", label: "Office" },
      ],
    },
  },
};
const service = {
  id: "app-one",
  name: "App One",
  type: "service",
  icon: "mdi:test",
  href: "https://default.example.invalid/Case",
  extensions: {
    network: {
      addresses: { lan: "http://lan.example.invalid:8080/Case?x=2#Part", vpn: "https://vpn.example.invalid" },
    },
  },
  widgets: [],
};
const other = { ...service, id: "app-two", name: "App Two" };
let clipboardDescriptor;
let writeText;

async function language(lng) {
  const i18n = createInstance();
  await i18n.init({
    lng,
    fallbackLng: "en",
    defaultNS: "common",
    resources: { en: { common: en }, "zh-Hans": { common: zh } },
    interpolation: { escapeValue: false },
  });
  state.t = (key, options) => i18n.t(key, options);
}

function Scene({ services = [service], settings = config, target } = {}) {
  return (
    <SettingsContext.Provider value={{ settings: { target, showStats: false } }}>
      <NetworkProvider initialSettings={settings}>
        <ModeSwitcher />
        <ul>
          {services.map((item) => (
            <Item key={item.id} service={item} groupName="G" />
          ))}
        </ul>
      </NetworkProvider>
    </SettingsContext.Provider>
  );
}
async function openMenu(name = "App One") {
  const trigger = screen.getByRole("button", { name: `Addresses for ${name}` });
  fireEvent.click(trigger);
  const menu = await screen.findByRole("menu");
  await waitFor(() => expect(within(menu).getAllByRole("menuitem")[0]).toHaveFocus());
  return { trigger, menu };
}
function preventNativeNavigation() {
  const before = vi.fn();
  const handler = (event) => {
    before(event.defaultPrevented);
    event.preventDefault();
  };
  document.addEventListener("click", handler, { once: true });
  return before;
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.removeItem(NETWORK_PREFERENCE_KEY);
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  vi.stubGlobal("isSecureContext", true);
  await language("en");
});
afterEach(() => {
  if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else delete navigator.clipboard;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("service address menu content and native links", () => {
  it("uses a visible button outside anchors and a Portal outside the clipped card", async () => {
    const view = render(<Scene />);
    const { trigger, menu } = await openMenu();
    expect(trigger.closest("a")).toBeNull();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", menu.id);
    expect(menu.closest(".service-card")).toBeNull();
    expect(view.container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Open default addressCurrent",
      "Open LAN address",
      "Open VPN address",
      "Copy current address",
    ]);
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(items[1]).toHaveAttribute("href", service.extensions.network.addresses.lan);
    expect(items[2]).toHaveAttribute("href", service.extensions.network.addresses.vpn);
    expect(menu).not.toHaveTextContent("example.invalid");
    expect(menu).not.toHaveTextContent("Open Office address");
  });

  it.each([
    ["_self", "_parent", "_self"],
    [undefined, "_parent", "_parent"],
    [undefined, undefined, "_blank"],
  ])("keeps target/rel precedence %j/%j", async (target, globalTarget, expected) => {
    render(<Scene services={[{ ...service, target }]} target={globalTarget} />);
    const { menu } = await openMenu();
    for (const link of within(menu)
      .getAllByRole("menuitem")
      .filter((item) => item.tagName === "A")) {
      expect(link).toHaveAttribute("target", expected);
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
  });

  it("shows fallback source and only actual candidates, including equal-URL modes", async () => {
    const same = { ...service, extensions: { network: { addresses: { lan: service.href, vpn: service.href } } } };
    render(<Scene services={[same]} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "office" } });
    const { menu } = await openMenu();
    expect(within(menu).getByRole("note")).toHaveTextContent("Currently using the default address");
    const links = within(menu)
      .getAllByRole("menuitem")
      .filter((item) => item.tagName === "A");
    expect(links).toHaveLength(3);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([service.href, service.href, service.href]);
    expect(links.filter((link) => link.getAttribute("aria-current") === "true")).toHaveLength(1);
    expect(links[0]).toHaveAttribute("aria-current", "true");
  });

  it("temporarily opens another real href without changing the global preference or canceling native clicks", async () => {
    localStorage.setItem(NETWORK_PREFERENCE_KEY, '{"version":1,"mode":"lan"}');
    const write = vi.spyOn(Storage.prototype, "setItem");
    render(<Scene />);
    const { menu, trigger } = await openMenu();
    const link = within(menu).getByRole("menuitem", { name: "Open VPN address" });
    const before = preventNativeNavigation();
    fireEvent.click(link, { ctrlKey: true });
    expect(before).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("combobox")).toHaveValue("lan");
    expect(localStorage.getItem(NETWORK_PREFERENCE_KEY)).toBe('{"version":1,"mode":"lan"}');
    expect(write).not.toHaveBeenCalled();
    expect(service.href).toBe("https://default.example.invalid/Case");
  });

  it("cancels a deferred link-close when a different menu opens in the same turn", async () => {
    render(<Scene services={[service, other]} />);
    const { menu } = await openMenu();
    preventNativeNavigation();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Open LAN address" }));
    fireEvent.click(screen.getByRole("button", { name: "Addresses for App Two" }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(screen.getByRole("menu")).toHaveAccessibleName("Addresses for App Two");
  });

  it("does not prevent native auxiliary clicks or context menus on menu links", async () => {
    render(<Scene />);
    const { menu } = await openMenu();
    const link = within(menu).getByRole("menuitem", { name: "Open LAN address" });
    const event = new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true });
    act(() => link.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(fireEvent.contextMenu(link)).toBe(true);
    expect(screen.getByRole("menu")).toBe(menu);
  });
});

describe("menu triggers, lifecycle and keyboard", () => {
  it.each([".service-title-text", ".service-icon"])(
    "takes right-click only on the %s navigation anchor and restores that trigger",
    async (selector) => {
      const { container } = render(<Scene />);
      const trigger = container.querySelector(`a${selector}`);
      expect(fireEvent.contextMenu(trigger, { clientX: 100, clientY: 120 })).toBe(false);
      const menu = await screen.findByRole("menu");
      expect(menu.style.left).toBe("100px");
      fireEvent.keyDown(menu, { key: "Escape" });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(trigger).toHaveFocus();
      expect(fireEvent.contextMenu(trigger, { shiftKey: true })).toBe(true);
      expect(screen.queryByRole("menu")).toBeNull();
    },
  );

  it("leaves Widget, statistics and ordinary legacy navigation alone", async () => {
    const item = { ...service, container: "fictional", server: "local", widgets: [{ index: 0 }] };
    const legacy = { ...other, extensions: undefined };
    const { container } = render(<Scene services={[item, legacy]} />);
    expect(screen.getAllByRole("button", { name: /Addresses for/ })).toHaveLength(1);
    const widget = screen.getByTestId("widget");
    const stats = screen.getByRole("button", { name: /View container stats/ });
    expect(fireEvent.contextMenu(widget)).toBe(true);
    expect(fireEvent.contextMenu(stats)).toBe(true);
    expect(fireEvent.contextMenu(container.querySelector("#app-two a.service-title-text"))).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    await openMenu();
    fireEvent.click(widget);
    expect(state.widgetClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(stats);
    expect(screen.getByTestId("docker-stats")).toBeInTheDocument();
  });

  it("keeps only one menu open, even after switching owners or reopening at a new point", async () => {
    const { container } = render(<Scene services={[service, other]} />);
    await openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Addresses for App Two" }));
    expect(await screen.findAllByRole("menu")).toHaveLength(1);
    expect(screen.getByRole("menu")).toHaveAccessibleName("Addresses for App Two");
    const second = container.querySelector("#app-two a.service-title-text");
    fireEvent.contextMenu(second, { clientX: 180, clientY: 220 });
    expect(await screen.findAllByRole("menu")).toHaveLength(1);
    expect(screen.getByRole("menu").style.left).toBe("180px");
  });

  it("supports arrows/Home/End/Escape and isolates menu keys from global search shortcuts", async () => {
    render(<Scene />);
    const { menu, trigger } = await openMenu();
    const items = within(menu).getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(items.at(-1)).toHaveFocus();
    fireEvent.keyDown(items.at(-1), { key: "ArrowDown" });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: "End" });
    expect(items.at(-1)).toHaveFocus();
    fireEvent.keyDown(items.at(-1), { key: "Home" });
    expect(items[0]).toHaveFocus();
    const shortcut = vi.fn();
    document.addEventListener("keydown", shortcut);
    try {
      fireEvent.keyDown(items[0], { key: "a" });
      fireEvent.keyDown(items[0], { key: "Escape" });
      expect(shortcut).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", shortcut);
    }
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("opens first/last from the more button's arrows and supports Space on links", async () => {
    render(<Scene />);
    const trigger = screen.getByRole("button", { name: "Addresses for App One" });
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    let menu = await screen.findByRole("menu");
    await waitFor(() => expect(within(menu).getAllByRole("menuitem").at(-1)).toHaveFocus());
    fireEvent.keyDown(menu, { key: "Escape" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    menu = await screen.findByRole("menu");
    const first = within(menu).getAllByRole("menuitem")[0];
    await waitFor(() => expect(first).toHaveFocus());
    const before = preventNativeNavigation();
    fireEvent.keyDown(first, { key: " " });
    expect(before).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("closes on Tab and button toggling without preventing native Tab", async () => {
    render(<Scene />);
    let opened = await openMenu();
    expect(fireEvent.keyDown(opened.menu, { key: "Tab" })).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(opened.trigger).toHaveFocus();
    opened = await openMenu();
    fireEvent.click(opened.trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it.each(["pointerdown", "click", "contextmenu", "scroll", "resize"])(
    "closes on outside %s without leaking listeners",
    async (eventName) => {
      render(<Scene />);
      const { trigger } = await openMenu();
      const target = ["scroll", "resize"].includes(eventName) ? window : document.body;
      act(() => target.dispatchEvent(new Event(eventName, { bubbles: true })));
      expect(screen.queryByRole("menu")).toBeNull();
      expect(trigger).toHaveFocus();
    },
  );

  it("does not close for scrolling inside a tall menu", async () => {
    render(<Scene />);
    const { menu } = await openMenu();
    fireEvent.scroll(menu);
    expect(screen.getByRole("menu")).toBe(menu);
  });

  it("closes on mode, configuration, service replacement and disappearance", async () => {
    const view = render(<Scene />);
    await openMenu();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "lan" } });
    expect(screen.queryByRole("menu")).toBeNull();
    await openMenu();
    view.rerender(<Scene settings={{ ...config }} />);
    expect(screen.queryByRole("menu")).toBeNull();
    await openMenu();
    view.rerender(<Scene services={[{ ...service, description: "Updated" }]} />);
    expect(screen.queryByRole("menu")).toBeNull();
    await openMenu();
    view.rerender(<Scene services={[]} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("clamps measured geometry at viewport edges and disconnects resize observers", async () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    let resize;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback) {
          resize = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.getAttribute("role") === "menu") return { width: 256, height: 200 };
      return original.call(this);
    });
    const { container } = render(<Scene />);
    fireEvent.contextMenu(container.querySelector("a.service-title-text"), {
      clientX: window.innerWidth - 1,
      clientY: window.innerHeight - 1,
    });
    const menu = await screen.findByRole("menu");
    expect(menu.style.left).toBe(`${window.innerWidth - 256 - 8}px`);
    expect(menu.style.top).toBe(`${window.innerHeight - 200 - 8}px`);
    expect(observe).toHaveBeenCalledWith(menu);
    act(() => resize());
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("cleans up listeners under StrictMode, including unmount while open", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const view = render(
      <StrictMode>
        <Scene />
      </StrictMode>,
    );
    await openMenu();
    const types = ["pointerdown", "click", "contextmenu"];
    const activeAdds = add.mock.calls.filter(([type, , capture]) => types.includes(type) && capture === true);
    view.unmount();
    for (const [type, listener, capture] of activeAdds) expect(remove).toHaveBeenCalledWith(type, listener, capture);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it.each([{}, { extensions: { network: { enabled: false } } }])(
    "has no menu for disabled configuration: %j",
    (settings) => {
      render(<Scene settings={settings} />);
      expect(screen.queryByRole("button", { name: /Addresses for/ })).toBeNull();
    },
  );

  it.each(["#", "", undefined])("has no menu for an unusable original href: %j", (href) => {
    render(<Scene services={[{ ...service, href }]} />);
    expect(screen.queryByRole("button", { name: /Addresses for/ })).toBeNull();
  });

  it("leaves malformed/unsafe-only alternate addresses on native navigation", () => {
    const invalid = {
      ...service,
      extensions: { network: { addresses: { lan: "javascript:bad", vpn: "file:///bad" } } },
    };
    const { container } = render(<Scene services={[invalid]} />);
    expect(screen.queryByRole("button", { name: /Addresses for/ })).toBeNull();
    expect(fireEvent.contextMenu(container.querySelector("a.service-title-text"))).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes an open menu for Shift+right-click without preventing the browser menu", async () => {
    const { container } = render(<Scene />);
    await openMenu();
    expect(fireEvent.contextMenu(container.querySelector("a.service-title-text"), { shiftKey: true })).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not cancel native Enter activation on an address link", async () => {
    render(<Scene />);
    const { menu } = await openMenu();
    const link = within(menu).getByRole("menuitem", { name: "Open LAN address" });
    link.focus();
    expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(true);
    expect(link).toHaveAttribute("href", service.extensions.network.addresses.lan);
  });

  it("does not render menu triggers or browser APIs during SSR recovery", () => {
    const read = vi.spyOn(Storage.prototype, "getItem");
    const html = renderToString(<Scene />);
    expect(html).not.toContain("service-address-menu-trigger");
    expect(html).not.toContain('role="menu"');
    expect(read).not.toHaveBeenCalled();
  });
});

describe("menu clipboard feedback and translations", () => {
  it.each([
    ["lan", service.extensions.network.addresses.lan],
    ["office", service.href],
  ])("copies %s resolved/fallback address and confirms success without changing mode", async (mode, href) => {
    localStorage.setItem(NETWORK_PREFERENCE_KEY, JSON.stringify({ version: 1, mode }));
    render(<Scene />);
    const { menu } = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy current address" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Address copied");
    expect(writeText).toHaveBeenCalledExactlyOnceWith(href);
    expect(screen.getByRole("combobox")).toHaveValue(mode);
  });

  it.each(["rejected", "missing", "http", "throwing-getter"])(
    "reports clipboard %s instead of false success",
    async (failure) => {
      if (failure === "rejected") writeText.mockRejectedValue(new Error("Permission denied"));
      if (failure === "missing")
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      if (failure === "http") vi.stubGlobal("isSecureContext", false);
      if (failure === "throwing-getter")
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          get() {
            throw new Error("Denied");
          },
        });
      render(<Scene />);
      const { menu } = await openMenu();
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy current address" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(en.network.copyFailed);
      expect(screen.queryByRole("status")).toBeNull();
      if (failure !== "rejected") expect(writeText).not.toHaveBeenCalled();
    },
  );

  it("keeps keyboard focus inside the menu while copy is pending and skips the disabled action", async () => {
    let resolve;
    writeText.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(<Scene />);
    const { menu } = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy current address" }));
    expect(menu).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(within(menu).getByRole("menuitem", { name: "Open VPN address" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement, { key: "ArrowDown" });
    const first = within(menu).getAllByRole("menuitem")[0];
    expect(first).toHaveFocus();
    await act(async () => resolve());
    expect(first).toHaveFocus();
  });

  it("ignores an old clipboard promise after another menu opens", async () => {
    let resolve;
    writeText.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(<Scene services={[service, other]} />);
    const { menu } = await openMenu();
    const copy = within(menu).getByRole("menuitem", { name: "Copy current address" });
    fireEvent.click(copy);
    expect(copy).toBeDisabled();
    expect(menu).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Addresses for App Two" }));
    expect(await screen.findByRole("menu")).toHaveAccessibleName("Addresses for App Two");
    await act(async () => resolve());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([
    ["zh-Hans", "App One 的地址菜单", "复制当前地址"],
    ["fr", "Addresses for App One", "Copy current address"],
  ])("uses actual resources/fallback for %s", async (lng, triggerLabel, copyLabel) => {
    await language(lng);
    render(<Scene />);
    fireEvent.click(screen.getByRole("button", { name: triggerLabel }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: copyLabel })).toBeInTheDocument();
  });

  it("keeps configured mode labels literal, including markup-looking text", async () => {
    const settings = { extensions: { network: { modes: [{ id: "lan", label: "<b>LAN</b>" }] } } };
    render(<Scene settings={settings} />);
    const { menu } = await openMenu();
    expect(within(menu).getByRole("menuitem", { name: "Open <b>LAN</b> address" })).toBeInTheDocument();
    expect(menu.querySelector("b")).toBeNull();
  });
});
