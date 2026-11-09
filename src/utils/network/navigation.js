import { normalizeServiceAddresses } from "utils/network/config";
import { resolveServiceLink } from "utils/network/resolver";

// UI readiness is separate from the pure address resolver. Both cards and search
// use this adapter, always with the original service, never a derived search entry.
export function getServiceNavigation(service, { settings, mode, ready }) {
  const link = resolveServiceLink(service, settings, mode);
  const { eligible } = normalizeServiceAddresses(service, settings);
  const pending = eligible && !ready;
  return { ...link, eligible, pending, href: pending ? undefined : link.href, hasLink: link.hasLink && !pending };
}

export function getServiceSearchEntry(service, network) {
  const navigation = getServiceNavigation(service, network);
  return navigation.eligible ? { ...service, href: navigation.href } : service;
}
