// @vitest-environment jsdom

import { act, fireEvent, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ModeSwitcher from "components/network/mode-switcher";
import { renderWithProviders } from "test-utils/render-with-providers";
import { NetworkProvider } from "utils/contexts/network";
import { SettingsContext } from "utils/contexts/settings";
import { NETWORK_PREFERENCE_KEY } from "utils/network/storage";

vi.mock("components/resolvedicon", () => ({
  default: function ResolvedIconMock() {
    return <div data-testid="resolved-icon" />;
  },
}));

vi.mock("widgets/docker/component", () => ({
  default: function DockerWidgetMock() {
    return <div data-testid="docker-widget" />;
  },
}));

vi.mock("widgets/kubernetes/component", () => ({
  default: function KubernetesWidgetMock() {
    return <div data-testid="kubernetes-widget" />;
  },
}));

vi.mock("widgets/proxmoxvm/component", () => ({
  default: function ProxmoxVMWidgetMock() {
    return <div data-testid="proxmoxvm-widget" />;
  },
}));

vi.mock("./ping", () => ({
  default: function PingMock() {
    return <div data-testid="ping" />;
  },
}));
vi.mock("./site-monitor", () => ({
  default: function SiteMonitorMock() {
    return <div data-testid="site-monitor" />;
  },
}));
vi.mock("./status", () => ({
  default: function StatusMock() {
    return <div data-testid="status" />;
  },
}));
vi.mock("./kubernetes-status", () => ({
  default: function KubernetesStatusMock() {
    return <div data-testid="kubernetes-status" />;
  },
}));
vi.mock("./proxmox-status", () => ({
  default: function ProxmoxStatusMock() {
    return <div data-testid="proxmox-status" />;
  },
}));
vi.mock("./widget", () => ({
  default: function ServiceWidgetMock({ widget }) {
    return <div data-testid="service-widget">idx:{widget.index}</div>;
  },
}));

import Item from "./item";

describe("components/services/item", () => {
  it("renders the service title as a link when href is provided", () => {
    renderWithProviders(
      <Item
        groupName="G"
        useEqualHeights={false}
        service={{
          id: "svc1",
          name: "My Service",
          description: "Desc",
          href: "https://example.com",
          icon: "mdi:test",
          widgets: [],
        }}
      />,
      { settings: { target: "_self", showStats: false, statusStyle: "basic" } },
    );

    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href") === "https://example.com")).toBe(true);
    expect(screen.getByText("My Service")).toBeInTheDocument();
  });

  it("renders the icon without a link when href is missing or '#'", () => {
    renderWithProviders(
      <Item
        groupName="G"
        useEqualHeights={false}
        service={{
          id: "svc1",
          name: "My Service",
          description: "Desc",
          href: "#",
          icon: "mdi:test",
          widgets: [],
        }}
      />,
      { settings: { target: "_self", showStats: false, statusStyle: "basic" } },
    );

    // The title area should not create a clickable href="#" link.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByTestId("resolved-icon")).toBeInTheDocument();
  });

  it("toggles container stats on click when stats are hidden by default", () => {
    renderWithProviders(
      <Item
        groupName="G"
        useEqualHeights={false}
        service={{
          id: "svc1",
          name: "My Service",
          description: "Desc",
          href: "https://example.com",
          container: "c",
          server: "s",
          ping: true,
          siteMonitor: true,
          widgets: [{ index: 1 }, { index: 2 }],
        }}
      />,
      { settings: { showStats: false, statusStyle: "basic" } },
    );

    expect(screen.queryByTestId("docker-widget")).not.toBeInTheDocument();
    expect(screen.getByTestId("ping")).toBeInTheDocument();
    expect(screen.getByTestId("site-monitor")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View container stats" }));
    expect(screen.getByTestId("docker-widget")).toBeInTheDocument();

    expect(screen.getAllByTestId("service-widget")).toHaveLength(2);
  });

  it("shows stats by default when settings.showStats is enabled, unless overridden by the service", () => {
    const baseService = {
      id: "svc1",
      name: "My Service",
      description: "Desc",
      container: "c",
      server: "s",
      widgets: [],
    };

    renderWithProviders(<Item groupName="G" useEqualHeights={false} service={baseService} />, {
      settings: { showStats: true, statusStyle: "basic" },
    });
    expect(screen.getByTestId("docker-widget")).toBeInTheDocument();

    renderWithProviders(
      <Item groupName="G" useEqualHeights={false} service={{ ...baseService, id: "svc2", showStats: false }} />,
      {
        settings: { showStats: true, statusStyle: "basic" },
      },
    );
    expect(screen.getAllByTestId("docker-widget")).toHaveLength(1);
  });

  it("closes stats after a short delay when toggled closed", async () => {
    vi.useFakeTimers();

    renderWithProviders(
      <Item
        groupName="G"
        useEqualHeights={false}
        service={{
          id: "svc1",
          name: "My Service",
          description: "Desc",
          container: "c",
          server: "s",
          widgets: [],
        }}
      />,
      { settings: { showStats: false, statusStyle: "basic" } },
    );

    const btn = screen.getByRole("button", { name: "View container stats" });
    fireEvent.click(btn);
    expect(screen.getByTestId("docker-widget")).toBeInTheDocument();

    fireEvent.click(btn);
    // Still rendered while the close animation runs.
    expect(screen.getByTestId("docker-widget")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByTestId("docker-widget")).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("toggles app and proxmox stats using their respective status tags", () => {
    renderWithProviders(
      <Item
        groupName="G"
        useEqualHeights={false}
        service={{
          id: "svc1",
          name: "My Service",
          description: "Desc",
          app: "app",
          namespace: "default",
          proxmoxNode: "pve",
          proxmoxVMID: "100",
          proxmoxType: "qemu",
          widgets: [],
        }}
      />,
      { settings: { showStats: false, statusStyle: "basic" } },
    );

    const appBtn = screen.getByTestId("kubernetes-status").closest("button");
    expect(appBtn).toBeTruthy();
    fireEvent.click(appBtn);
    expect(screen.getByTestId("kubernetes-widget")).toBeInTheDocument();

    const proxmoxBtn = screen.getByTestId("proxmox-status").closest("button");
    expect(proxmoxBtn).toBeTruthy();
    fireEvent.click(proxmoxBtn);
    expect(screen.getByTestId("proxmoxvm-widget")).toBeInTheDocument();
  });

  it("does not render the app status tag when the service is marked external", () => {
    renderWithProviders(
      <Item
        groupName="G"
        useEqualHeights={false}
        service={{
          id: "svc1",
          name: "My Service",
          description: "Desc",
          app: "app",
          external: true,
          widgets: [],
        }}
      />,
      { settings: { showStats: false, statusStyle: "basic" } },
    );

    expect(screen.queryByTestId("kubernetes-status")).not.toBeInTheDocument();
  });
});

const networkSettings = {
  extensions: {
    network: {
      modes: [
        { id: "lan", label: "LAN" },
        { id: "vpn", label: "VPN" },
      ],
    },
  },
};
const networkService = Object.freeze({
  id: "network-service",
  name: "Network App",
  icon: "mdi:test",
  type: "service",
  href: "https://default.example.invalid/Case",
  extensions: Object.freeze({
    network: Object.freeze({ addresses: Object.freeze({ lan: "http://lan.example.invalid:8080/Case?x=2#Part" }) }),
  }),
  widgets: Object.freeze([{ index: 1, url: "http://widget.example.invalid" }]),
});

describe("service item network navigation", () => {
  beforeEach(() => localStorage.removeItem(NETWORK_PREFERENCE_KEY));
  afterEach(() => vi.restoreAllMocks());

  it("keeps title/icon hrefs in sync with the switcher and falls back without mutating the original", () => {
    renderWithProviders(
      <NetworkProvider initialSettings={networkSettings}>
        <ModeSwitcher />
        <Item service={networkService} groupName="G" />
      </NetworkProvider>,
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);
    for (const link of screen.getAllByRole("link")) expect(link).toHaveAttribute("href", networkService.href);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "lan" } });
    for (const link of screen.getAllByRole("link"))
      expect(link).toHaveAttribute("href", networkService.extensions.network.addresses.lan);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "vpn" } });
    for (const link of screen.getAllByRole("link")) expect(link).toHaveAttribute("href", networkService.href);
    expect(networkService.href).toBe("https://default.example.invalid/Case");
    expect(networkService.widgets[0].url).toBe("http://widget.example.invalid");
  });

  it.each([
    ["_self", "_parent", "_self"],
    [undefined, "_parent", "_parent"],
    [undefined, undefined, "_blank"],
  ])("preserves target precedence %j / %j", (target, globalTarget, expected) => {
    localStorage.setItem(NETWORK_PREFERENCE_KEY, '{"version":1,"mode":"lan"}');
    renderWithProviders(
      <NetworkProvider initialSettings={networkSettings}>
        <Item service={{ ...networkService, target }} groupName="G" />
      </NetworkProvider>,
      { settings: { target: globalTarget } },
    );
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("href", networkService.extensions.network.addresses.lan);
      expect(link).toHaveAttribute("target", expected);
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
  });

  it("SSR suppresses both expandable anchors but leaves a legacy service and Widget intact", () => {
    const read = vi.spyOn(Storage.prototype, "getItem");
    const legacy = { id: "legacy-service", name: "Legacy", href: "/legacy", icon: "mdi:test", widgets: [] };
    const html = renderToString(
      <SettingsContext.Provider value={{ settings: {} }}>
        <NetworkProvider initialSettings={networkSettings}>
          <ul>
            <Item service={networkService} groupName="G" />
            <Item service={legacy} groupName="G" />
          </ul>
        </NetworkProvider>
      </SettingsContext.Provider>,
    );
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(container.querySelectorAll("#network-service a[href]")).toHaveLength(0);
    expect(container.querySelectorAll('#legacy-service a[href="/legacy"]')).toHaveLength(2);
    expect(container.querySelector("#network-service .service-name")).toHaveTextContent("Network App");
    expect(container.querySelector('[data-testid="service-widget"]')).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
  });

  it("hydrates real card links directly to the saved mode without ever attaching the default href", async () => {
    localStorage.setItem(NETWORK_PREFERENCE_KEY, '{"version":1,"mode":"lan"}');
    const ui = (
      <SettingsContext.Provider value={{ settings: {} }}>
        <NetworkProvider initialSettings={networkSettings}>
          <ul>
            <Item service={networkService} groupName="G" />
          </ul>
        </NetworkProvider>
      </SettingsContext.Provider>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(ui);
    document.body.append(container);
    const attributes = vi.spyOn(Element.prototype, "setAttribute");
    const recoverable = vi.fn();
    let root;
    try {
      await act(async () => {
        root = hydrateRoot(container, ui, { onRecoverableError: recoverable });
      });
      const links = container.querySelectorAll("a[href]");
      expect(links).toHaveLength(2);
      for (const link of links) expect(link).toHaveAttribute("href", networkService.extensions.network.addresses.lan);
      expect(attributes.mock.calls.filter(([name, value]) => name === "href" && value === networkService.href)).toEqual(
        [],
      );
      expect(recoverable).not.toHaveBeenCalled();
    } finally {
      if (root) await act(async () => root.unmount());
      attributes.mockRestore();
      container.remove();
    }
  });

  it("restores saved LAN directly and preserves Widget nodes and open statistics across mode changes", () => {
    localStorage.setItem(NETWORK_PREFERENCE_KEY, '{"version":1,"mode":"lan"}');
    renderWithProviders(
      <NetworkProvider initialSettings={networkSettings}>
        <ModeSwitcher />
        <Item service={{ ...networkService, container: "fictional", server: "local" }} groupName="G" />
      </NetworkProvider>,
      { settings: { showStats: false } },
    );
    const widget = screen.getByTestId("service-widget");
    for (const link of screen.getAllByRole("link"))
      expect(link).toHaveAttribute("href", networkService.extensions.network.addresses.lan);
    fireEvent.click(screen.getByRole("button", { name: "View container stats" }));
    const stats = screen.getByTestId("docker-widget");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "default" } });
    expect(screen.getByTestId("service-widget")).toBe(widget);
    expect(screen.getByTestId("docker-widget")).toBe(stats);
    expect(fireEvent.contextMenu(widget)).toBe(true);
  });

  it("uses original hrefs and does not read preferences when explicitly disabled", () => {
    const read = vi.spyOn(Storage.prototype, "getItem");
    renderWithProviders(
      <NetworkProvider initialSettings={{ extensions: { network: { enabled: false } } }}>
        <ModeSwitcher />
        <Item service={networkService} groupName="G" />
      </NetworkProvider>,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    for (const link of screen.getAllByRole("link")) expect(link).toHaveAttribute("href", networkService.href);
    expect(read).not.toHaveBeenCalled();
  });
});
