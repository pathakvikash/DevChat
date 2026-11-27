import { useSyncExternalStore } from "react";

let streaming = false;
const listeners = new Set<() => void>();

export function setStreaming(v: boolean) {
  if (v === streaming) return;
  streaming = v;
  listeners.forEach((l) => l());
}

export function useIsStreaming(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => streaming,
    () => false,
  );
}

/** Test hook: current value without React. */
export function getStreaming(): boolean {
  return streaming;
}
