export const NETWORK_PREFERENCE_KEY = "homepage.network.preference.v1";

// Parse without a browser dependency. Defined-mode validation belongs to the Provider.
export function parseNetworkPreference(value) {
  if (typeof value !== "string") return null;
  try {
    const preference = JSON.parse(value);
    if (
      preference === null ||
      typeof preference !== "object" ||
      Array.isArray(preference) ||
      !Object.hasOwn(preference, "version") ||
      preference.version !== 1 ||
      !Object.hasOwn(preference, "mode") ||
      typeof preference.mode !== "string"
    ) {
      return null;
    }
    return preference.mode;
  } catch {
    return null;
  }
}

export function readNetworkPreference() {
  try {
    if (typeof window === "undefined") return null;
    return parseNetworkPreference(window.localStorage.getItem(NETWORK_PREFERENCE_KEY));
  } catch {
    // Storage access itself can throw, not just getItem (e.g. blocked site data).
    return null;
  }
}

export function writeNetworkPreference(mode) {
  if (typeof mode !== "string") return false;
  try {
    if (typeof window === "undefined") return false;
    window.localStorage.setItem(NETWORK_PREFERENCE_KEY, JSON.stringify({ version: 1, mode }));
    return true;
  } catch {
    return false;
  }
}

export function removeNetworkPreference() {
  try {
    if (typeof window === "undefined") return false;
    window.localStorage.removeItem(NETWORK_PREFERENCE_KEY);
    return true;
  } catch {
    return false;
  }
}
