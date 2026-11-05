const MODE_ID = /^[a-z][a-z0-9_-]{0,31}$/;
const RESERVED_IDS = new Set(["__proto__", "constructor", "prototype"]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function isMapping(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function own(value, key) {
  return isMapping(value) && Object.hasOwn(value, key);
}

function networkExtension(value) {
  return own(value, "extensions") && own(value.extensions, "network");
}

function defaultSettings() {
  // A null built-in label is translated by the UI, never by these pure functions.
  return { enabled: false, defaultMode: "default", modes: [{ id: "default", label: null }], diagnostics: [] };
}

export function normalizeNetworkSettings(rawSettings) {
  const result = defaultSettings();
  if (!networkExtension(rawSettings)) return result;
  const network = rawSettings.extensions.network;
  const path = "settings.extensions.network";
  if (!isMapping(network)) {
    result.diagnostics.push({ path, code: "invalid-network" });
    return result;
  }
  if (own(network, "enabled") && typeof network.enabled !== "boolean") {
    result.diagnostics.push({ path: `${path}.enabled`, code: "invalid-enabled" });
    return result;
  }
  if (own(network, "enabled") && network.enabled === false) return result;
  if (own(network, "modes") && !Array.isArray(network.modes)) {
    result.diagnostics.push({ path: `${path}.modes`, code: "invalid-modes" });
    return result;
  }

  result.enabled = true;
  const seen = new Set();
  const modes = own(network, "modes") ? network.modes : [];
  modes.forEach((mode, index) => {
    const modePath = `${path}.modes[${index}]`;
    if (!own(mode, "id") || typeof mode.id !== "string" || !MODE_ID.test(mode.id) || RESERVED_IDS.has(mode.id)) {
      result.diagnostics.push({ path: `${modePath}.id`, code: "invalid-mode-id" });
      return;
    }
    if (!own(mode, "label") || typeof mode.label !== "string") {
      result.diagnostics.push({ path: `${modePath}.label`, code: "invalid-mode-label" });
      return;
    }
    const label = mode.label.trim();
    if (Array.from(label).length < 1 || Array.from(label).length > 64) {
      result.diagnostics.push({ path: `${modePath}.label`, code: "invalid-mode-label" });
      return;
    }
    if (seen.has(mode.id)) {
      result.diagnostics.push({ path: modePath, code: "duplicate-mode" });
      return;
    }
    seen.add(mode.id);
    if (mode.id === "default") result.modes[0] = { id: mode.id, label };
    else result.modes.push({ id: mode.id, label });
  });

  if (own(network, "defaultMode")) {
    if (typeof network.defaultMode === "string" && result.modes.some((mode) => mode.id === network.defaultMode)) {
      result.defaultMode = network.defaultMode;
    } else {
      result.diagnostics.push({ path: `${path}.defaultMode`, code: "invalid-default-mode" });
    }
  }
  return result;
}

export function hasUsableDefaultHref(service) {
  return typeof service?.href === "string" && service.href.trim() !== "" && service.href.trim() !== "#";
}

function normalizeAddress(value) {
  if (value === null || value === "") return {};
  if (typeof value !== "string") return { code: "invalid-address-type" };
  // Check before trim/URL parsing: both can silently discard forbidden characters.
  if (CONTROL_CHARACTERS.test(value)) return { code: "address-control-character" };
  const href = value.trim();
  if (!href) return {};
  if (!/^https?:\/\//i.test(href)) return { code: "invalid-address-url" };
  try {
    const url = new URL(href);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) return { code: "invalid-address-url" };
    if (url.username || url.password) return { code: "address-credentials" };
  } catch {
    return { code: "invalid-address-url" };
  }
  return { href };
}

export function normalizeServiceAddresses(service, settings) {
  const result = { eligible: false, addresses: {}, diagnostics: [] };
  if (!settings.enabled || !networkExtension(service)) return result;
  const network = service.extensions.network;
  const path = "extensions.network";
  if (!isMapping(network)) {
    result.diagnostics.push({ path, code: "invalid-service-network" });
    return result;
  }
  if (!own(network, "addresses")) return result;
  if (!isMapping(network.addresses)) {
    result.diagnostics.push({ path: `${path}.addresses`, code: "invalid-addresses" });
    return result;
  }
  const ids = new Set(settings.modes.map((mode) => mode.id));
  Object.entries(network.addresses).forEach(([id, value], index) => {
    // Indices locate the entry without reflecting untrusted keys/URLs into logs.
    const addressPath = `${path}.addresses[${index}]`;
    if (id === "default") {
      result.diagnostics.push({ path: addressPath, code: "reserved-default-address" });
      return;
    }
    if (RESERVED_IDS.has(id) || !ids.has(id)) {
      result.diagnostics.push({ path: addressPath, code: "unknown-address-mode" });
      return;
    }
    const address = normalizeAddress(value);
    if (address.code) result.diagnostics.push({ path: addressPath, code: address.code });
    else if (address.href) result.addresses[id] = address.href;
  });
  result.eligible = hasUsableDefaultHref(service) && Object.keys(result.addresses).length > 0;
  return result;
}

// Operates on already Widget-sanitized groups; does not touch their connection data.
export function normalizeNetworkServiceGroups(groups, settings) {
  const diagnostics = [...settings.diagnostics];
  function visit(items, path) {
    return items.map((group, groupIndex) => {
      const groupPath = `${path}[${groupIndex}]`;
      return {
        ...group,
        services: group.services.map((service, serviceIndex) => {
          if (!networkExtension(service)) return service;
          const normalized = normalizeServiceAddresses(service, settings);
          diagnostics.push(
            ...normalized.diagnostics.map((diagnostic) => ({
              ...diagnostic,
              path: `${groupPath}.services[${serviceIndex}].${diagnostic.path}`,
            })),
          );
          const extensions = { ...service.extensions };
          // Disabled/malformed network data is not forwarded, but other namespaces survive.
          delete extensions.network;
          if (settings.enabled && isMapping(service.extensions.network)) {
            extensions.network = { ...service.extensions.network, addresses: normalized.addresses };
          }
          return { ...service, extensions };
        }),
        ...(group.groups && { groups: visit(group.groups, `${groupPath}.groups`) }),
      };
    });
  }
  return { groups: visit(groups, "services"), diagnostics };
}
