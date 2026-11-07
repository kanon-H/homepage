// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../../public/locales/en/common.json";
import zh from "../../../public/locales/zh-Hans/common.json";

import ModeSwitcher from "./mode-switcher";

import { NetworkProvider } from "utils/contexts/network";
import { NETWORK_PREFERENCE_KEY } from "utils/network/storage";

const state = vi.hoisted(() => ({ t: (key) => key }));
vi.mock("next-i18next/pages", () => ({ useTranslation: () => ({ t: (key) => state.t(key) }) }));
const config = {
  extensions: {
    network: {
      modes: [
        { id: "lan", label: "内网" },
        { id: "vpn", label: "VPN" },
      ],
    },
  },
};

async function language(lng) {
  const i18n = createInstance();
  await i18n.init({
    lng,
    fallbackLng: "en",
    defaultNS: "common",
    resources: { en: { common: en }, "zh-Hans": { common: zh } },
  });
  state.t = (key) => i18n.t(key);
}

beforeEach(async () => {
  localStorage.removeItem(NETWORK_PREFERENCE_KEY);
  await language("en");
});
afterEach(() => vi.restoreAllMocks());

describe("network mode switcher", () => {
  it.each([undefined, {}, { extensions: { network: { enabled: false } } }, { extensions: { network: {} } }])(
    "is absent for disabled or default-only settings: %j",
    (initialSettings) => {
      render(
        <NetworkProvider initialSettings={initialSettings}>
          <ModeSwitcher />
        </NetworkProvider>,
      );
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    },
  );

  it("is absent without a Provider", () => {
    const { container } = render(<ModeSwitcher />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a disabled native select during SSR, without touching storage", () => {
    const read = vi.spyOn(Storage.prototype, "getItem");
    const html = renderToString(
      <NetworkProvider initialSettings={config}>
        <ModeSwitcher />
      </NetworkProvider>,
    );
    const container = document.createElement("div");
    container.innerHTML = html;
    const select = container.querySelector("select");
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute("aria-busy", "true");
    expect(select).toHaveAttribute("title", en.network.restoring);
    expect(select.value).toBe("default");
    expect(read).not.toHaveBeenCalled();
  });

  it("restores the selected mode and saves an explicit change without a refresh", () => {
    localStorage.setItem(NETWORK_PREFERENCE_KEY, '{"version":1,"mode":"lan"}');
    const write = vi.spyOn(Storage.prototype, "setItem");
    render(
      <NetworkProvider initialSettings={config}>
        <ModeSwitcher />
      </NetworkProvider>,
    );
    const select = screen.getByRole("combobox", { name: "Network mode" });
    expect(select).toBeEnabled();
    expect(select).toHaveValue("lan");
    expect(write).not.toHaveBeenCalled();
    select.focus();
    expect(select).toHaveFocus();
    fireEvent.change(select, { target: { value: "vpn" } });
    expect(select).toHaveValue("vpn");
    expect(write).toHaveBeenCalledExactlyOnceWith(NETWORK_PREFERENCE_KEY, '{"version":1,"mode":"vpn"}');
  });

  it.each([
    ["en", "Network mode", "Default"],
    ["zh-Hans", "网络模式", "默认"],
    ["fr", "Network mode", "Default"],
  ])("uses translation resources/fallback for %s", async (lng, label, defaultLabel) => {
    await language(lng);
    render(
      <NetworkProvider initialSettings={config}>
        <ModeSwitcher />
      </NetworkProvider>,
    );
    expect(screen.getByRole("combobox", { name: label })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: defaultLabel })).toHaveValue("default");
    expect(screen.getAllByRole("option").map((option) => option.value)).toEqual(["default", "lan", "vpn"]);
  });

  it("renders configured labels as literal text, not markup or translation keys", () => {
    const settings = {
      extensions: {
        network: {
          modes: [
            { id: "default", label: "network.default" },
            { id: "lan", label: "<b>LAN</b>" },
          ],
        },
      },
    };
    const { container } = render(
      <NetworkProvider initialSettings={settings}>
        <ModeSwitcher />
      </NetworkProvider>,
    );
    expect(screen.getByRole("option", { name: "network.default" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "<b>LAN</b>" })).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
  });
});
