import { hasUsableDefaultHref, normalizeServiceAddresses } from "utils/network/config";

export function resolveServiceLink(service, settings, mode) {
  const requestedMode = settings.modes.some((candidate) => candidate.id === mode) ? mode : settings.defaultMode;
  const { eligible, addresses } = normalizeServiceAddresses(service, settings);
  const alternate = eligible && requestedMode !== "default" && Object.hasOwn(addresses, requestedMode);
  const href = alternate ? addresses[requestedMode] : service.href;
  return {
    href,
    requestedMode,
    resolvedMode: alternate ? requestedMode : "default",
    fallback: settings.enabled && hasUsableDefaultHref(service) && requestedMode !== "default" && !alternate,
    // Keep upstream semantics for legacy hrefs, including special protocols/relative links.
    hasLink: Boolean(href && href !== "#"),
  };
}

export function getServiceAddressOptions(service, settings, mode) {
  const { eligible, addresses } = normalizeServiceAddresses(service, settings);
  if (!eligible) return [];
  const { resolvedMode } = resolveServiceLink(service, settings, mode);
  return settings.modes.flatMap(({ id, label }) => {
    if (id !== "default" && !Object.hasOwn(addresses, id)) return [];
    return [{ id, label, href: id === "default" ? service.href : addresses[id], current: id === resolvedMode }];
  });
}
