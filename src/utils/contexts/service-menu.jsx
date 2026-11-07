import { createContext, useContext, useEffect, useId, useState, useSyncExternalStore } from "react";

const ServiceMenuContext = createContext(null);
const emptyStore = { subscribe: () => () => {}, getSnapshot: () => null, getServerSnapshot: () => null };

// UI state only, scoped to one NetworkProvider. No global menu, browser mode,
// configuration mutation, or DOM access during creation/render/SSR.
function createMenuStore() {
  let snapshot = null;
  let sequence = 0;
  const listeners = new Set();
  const publish = (value) => {
    snapshot = value;
    listeners.forEach((notify) => notify());
  };
  function close(expected) {
    if (!expected || snapshot !== expected) return;
    publish(null);
    if (expected.trigger.isConnected) expected.trigger.focus({ preventScroll: true });
  }
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => null,
    subscribe(notify) {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    open(value) {
      // Replacing a record never restores the previous trigger's focus.
      publish({ ...value, sequence: ++sequence });
    },
    close,
    closeOwner(owner) {
      if (snapshot?.owner === owner) close(snapshot);
    },
  };
}

export function ServiceMenuProvider({ children }) {
  const [store] = useState(createMenuStore);
  return <ServiceMenuContext.Provider value={store}>{children}</ServiceMenuContext.Provider>;
}

export function useServiceMenuTrigger({ service, network, navigation }) {
  const context = useContext(ServiceMenuContext);
  const store = context ?? emptyStore;
  const owner = useId();
  const active = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const enabled = Boolean(context && navigation.eligible && network.ready);
  const isOpen = Boolean(
    enabled &&
    active?.owner === owner &&
    active.service === service &&
    active.settings === network.settings &&
    active.mode === network.mode,
  );

  useEffect(() => {
    // Hide invalidated content in the render above, then release external UI state.
    if (active?.owner === owner && !isOpen) context.close(active);
  }, [active, owner, isOpen, context]);
  useEffect(() => () => context?.closeOwner(owner), [context, owner]);

  function open(trigger, point, last = false) {
    if (!enabled) return;
    context.open({ owner, trigger, point, last, service, settings: network.settings, mode: network.mode });
  }
  function openFromButton(event, last = false) {
    const rect = event.currentTarget.getBoundingClientRect();
    open(event.currentTarget, { x: rect.left, y: rect.bottom }, last);
  }

  return {
    enabled,
    isOpen,
    active: isOpen ? active : null,
    id: `network-service-menu-${owner}`,
    close: () => context?.close(active),
    isCurrent: () => context?.getSnapshot() === active,
    onContextMenu: enabled
      ? (event) => {
          if (event.shiftKey) {
            context.closeOwner(owner);
            return;
          }
          event.preventDefault();
          open(event.currentTarget, { x: event.clientX, y: event.clientY });
        }
      : undefined,
    onClick(event) {
      const current = context?.getSnapshot();
      if (current?.owner === owner) context.close(current);
      else openFromButton(event);
    },
    onKeyDown(event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        openFromButton(event, event.key === "ArrowUp");
      }
    },
  };
}
