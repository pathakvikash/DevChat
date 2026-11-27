import { useSyncExternalStore } from "react";

// How many panes are streaming right now; split panes each count once.
let count = 0;
const listeners = new Set<() => void>();

/** Sets one pane's streaming state. `pane` is that pane's own flag, so a repeat or an unmount can't decrement twice. */
export function setPaneStreaming(pane: { current: boolean }, on: boolean) {
  if (pane.current === on) return;
  pane.current = on;
  count += on ? 1 : -1;
  listeners.forEach((l) => l());
}

export function useIsStreaming(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => count > 0,
    () => false,
  );
}

/** Test hook: current value without React. */
export function getStreaming(): boolean {
  return count > 0;
}
