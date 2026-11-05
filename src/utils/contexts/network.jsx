import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from "react";

import { normalizeNetworkSettings } from "utils/network/config";
import {
  NETWORK_PREFERENCE_KEY,
  parseNetworkPreference,
  readNetworkPreference,
  writeNetworkPreference,
} from "utils/network/storage";

const INITIAL_SNAPSHOT = Object.freeze({ preference: null, ready: false });
const disabledNetwork = {
  settings: normalizeNetworkSettings(),
  mode: "default",
  ready: true,
  setMode: () => false,
};
const NetworkContext = createContext(disabledNetwork);

// Each mounted Provider owns its store. Creating/reading a snapshot is browser-free;
// only the React subscription lifecycle and explicit user events touch storage.
function createPreferenceStore() {
  let snapshot = INITIAL_SNAPSHOT;
  const listeners = new Set();

  function publish(preference) {
    if (snapshot.ready && snapshot.preference === preference) return;
    snapshot = { preference, ready: true };
    listeners.forEach((notify) => notify());
  }

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => INITIAL_SNAPSHOT,
    subscribe(notify) {
      listeners.add(notify);
      function handleStorage(event) {
        if (event.key !== NETWORK_PREFERENCE_KEY && event.key !== null) return;
        try {
          // Do not confuse sessionStorage (or an unidentified synthetic event)
          // with same-origin localStorage. The getter may throw when blocked.
          if (event.storageArea !== window.localStorage) return;
        } catch {
          return;
        }
        publish(parseNetworkPreference(event.newValue));
      }
      window.addEventListener("storage", handleStorage);
      publish(readNetworkPreference());
      return () => {
        window.removeEventListener("storage", handleStorage);
        listeners.delete(notify);
        // Re-enable/remount must restore before exposing a stale preference.
        if (listeners.size === 0) snapshot = INITIAL_SNAPSHOT;
      };
    },
    setMode(mode) {
      publish(mode);
      // A write failure must not prevent immediate in-memory switching.
      writeNetworkPreference(mode);
    },
  };
}

export function NetworkProvider({ initialSettings, children }) {
  const settings = useMemo(() => normalizeNetworkSettings(initialSettings), [initialSettings]);
  const [store] = useState(createPreferenceStore);
  const subscribe = useCallback(
    (notify) => (settings.enabled ? store.subscribe(notify) : () => {}),
    [settings.enabled, store],
  );
  const snapshot = useSyncExternalStore(subscribe, store.getSnapshot, store.getServerSnapshot);
  const mode =
    settings.enabled && settings.modes.some((candidate) => candidate.id === snapshot.preference)
      ? snapshot.preference
      : settings.defaultMode;
  const ready = !settings.enabled || snapshot.ready;
  const setMode = useCallback(
    (nextMode) => {
      if (!settings.enabled || !ready || !settings.modes.some((candidate) => candidate.id === nextMode)) return false;
      store.setMode(nextMode);
      return true;
    },
    [settings, ready, store],
  );
  const value = useMemo(() => ({ settings, mode, ready, setMode }), [settings, mode, ready, setMode]);
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork() {
  return useContext(NetworkContext);
}
