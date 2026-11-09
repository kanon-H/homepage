import { Portal } from "@headlessui/react";
import classNames from "classnames";
import { useTranslation } from "next-i18next/pages";
import { useCallback, useEffect, useRef, useState } from "react";
import { FiMoreHorizontal } from "react-icons/fi";

import { getServiceMenuPosition } from "utils/network/menu-position";
import { getServiceAddressOptions } from "utils/network/resolver";

function MenuPanel({ service, network, navigation, menu, target }) {
  const { t } = useTranslation();
  const panel = useRef(null);
  const focused = useRef(false);
  const navigationTimer = useRef(null);
  const [position, setPosition] = useState(null);
  const [copying, setCopying] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const { active } = menu;
  const options = getServiceAddressOptions(service, network.settings, network.mode);
  const label = t("network.addressesForService", { name: service.name, interpolation: { escapeValue: false } });

  const measure = useCallback(() => {
    const element = panel.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const next = getServiceMenuPosition(active.point, rect, { width: window.innerWidth, height: window.innerHeight });
    setPosition((previous) => (previous?.left === next.left && previous?.top === next.top ? previous : next));
  }, [active.point]);
  const setPanel = useCallback(
    (element) => {
      panel.current = element;
      if (element) measure();
    },
    [measure],
  );

  useEffect(() => {
    if (!position || focused.current) return;
    focused.current = true;
    const items = panel.current.querySelectorAll('[role="menuitem"]');
    items[active.last ? items.length - 1 : 0]?.focus();
  }, [position, active.last]);

  useEffect(() => {
    const element = panel.current;
    function outside(event) {
      const targetNode = event.target;
      if (!(targetNode instanceof Node) || (!element.contains(targetNode) && !active.trigger.contains(targetNode)))
        menu.close();
    }
    function scroll(event) {
      // Internal scrolling must remain usable in a short viewport/long-label menu.
      if (!(event.target instanceof Node) || !element.contains(event.target)) menu.close();
    }
    const resize = () => menu.close();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("click", outside, true);
    document.addEventListener("contextmenu", outside, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("click", outside, true);
      document.removeEventListener("contextmenu", outside, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
      observer?.disconnect();
      if (navigationTimer.current !== null) window.clearTimeout(navigationTimer.current);
    };
  }, [active, measure, menu]);

  useEffect(() => {
    // Re-measure feedback content even if ResizeObserver is unavailable.
    const frame = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(frame);
  }, [feedback, measure]);

  function handleKeyDown(event) {
    event.stopPropagation();
    const items = Array.from(panel.current.querySelectorAll('[role="menuitem"]')).filter((item) => !item.disabled);
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      menu.close();
    } else if (event.key === "Tab") {
      // Restore the trigger, then let the native Tab action advance from it.
      menu.close();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      let next = event.key === "ArrowUp" ? (index - 1 + items.length) % items.length : (index + 1) % items.length;
      if (index < 0) next = event.key === "ArrowUp" ? items.length - 1 : 0;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = items.length - 1;
      items[next]?.focus();
    } else if (event.key === " " && document.activeElement?.tagName === "A") {
      event.preventDefault();
      document.activeElement.click();
    }
  }

  function closeAfterNavigation() {
    // Let the real anchor's native activation finish before removing it.
    if (navigationTimer.current !== null) window.clearTimeout(navigationTimer.current);
    navigationTimer.current = window.setTimeout(() => menu.close(), 0);
  }

  async function copyCurrentAddress() {
    if (copying || !menu.isCurrent()) return;
    setCopying(true);
    // Keep focus inside the menu before disabling the focused copy button.
    panel.current?.focus({ preventScroll: true });
    let result = "copied";
    try {
      if (window.isSecureContext !== true || typeof navigator.clipboard?.writeText !== "function") {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(navigation.href);
    } catch {
      result = "copyFailed";
    }
    // A result from an old/closed menu must never update a new menu or steal focus.
    if (menu.isCurrent()) {
      setCopying(false);
      setFeedback(result);
    }
  }

  return (
    <div
      ref={setPanel}
      id={menu.id}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="network-service-menu fixed z-[100] w-64 max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-y-auto rounded-md border border-theme-300 dark:border-theme-600 bg-theme-100 dark:bg-theme-800 p-1 text-theme-700 dark:text-theme-200 shadow-xl focus:outline-none"
      style={{
        left: position?.left ?? active.point.x,
        top: position?.top ?? active.point.y,
        visibility: position ? undefined : "hidden",
      }}
    >
      {navigation.fallback && (
        <p className="px-3 py-2 text-xs" role="note">
          {t("network.usingDefault")}
        </p>
      )}
      {options.map((option) => (
        <a
          key={option.id}
          role="menuitem"
          tabIndex={-1}
          href={option.href}
          target={target}
          rel="noreferrer"
          aria-current={option.current ? "true" : undefined}
          onClick={closeAfterNavigation}
          className={classNames(
            "block rounded-sm px-3 py-2 text-sm break-words hover:bg-theme-300/50 focus:bg-theme-300/50 dark:focus:bg-theme-700/50 focus:outline-none",
            option.current && "font-semibold",
          )}
        >
          {option.id === "default"
            ? t("network.openDefault")
            : t("network.openMode", { label: option.label, interpolation: { escapeValue: false } })}
          {option.current && <span className="ml-2 text-xs">{t("network.current")}</span>}
        </a>
      ))}
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={copyCurrentAddress}
        disabled={copying}
        aria-busy={copying}
        className="block w-full rounded-sm border-t border-theme-300 dark:border-theme-600 px-3 py-2 text-left text-sm hover:bg-theme-300/50 focus:bg-theme-300/50 dark:focus:bg-theme-700/50 focus:outline-none disabled:opacity-50"
      >
        {t("network.copyCurrent")}
      </button>
      {feedback && (
        <p role={feedback === "copied" ? "status" : "alert"} className="px-3 py-2 text-xs">
          {t(`network.${feedback}`)}
        </p>
      )}
    </div>
  );
}

export default function ServiceMenu({ service, network, navigation, menu, target }) {
  const { t } = useTranslation();
  if (!menu.enabled) return null;
  return (
    <>
      <button
        type="button"
        aria-label={t("network.addressesForService", { name: service.name, interpolation: { escapeValue: false } })}
        aria-haspopup="menu"
        aria-expanded={menu.isOpen}
        aria-controls={menu.isOpen ? menu.id : undefined}
        onClick={menu.onClick}
        onKeyDown={menu.onKeyDown}
        className="service-address-menu-trigger relative z-20 mr-1 shrink-0 self-center rounded-md p-2 hover:bg-theme-300/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-theme-500"
      >
        <FiMoreHorizontal aria-hidden="true" className="h-4 w-4" />
      </button>
      {menu.isOpen && (
        <Portal>
          <MenuPanel
            key={menu.active.sequence}
            service={service}
            network={network}
            navigation={navigation}
            menu={menu}
            target={target}
          />
        </Portal>
      )}
    </>
  );
}
