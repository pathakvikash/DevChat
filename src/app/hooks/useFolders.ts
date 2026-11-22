"use client";

import { useEffect, useSyncExternalStore } from "react";

export type Folder = { path: string; source: "added" | "claude-code" };
type FoldersResponse = { folders: Folder[]; hostTools: boolean; reason: string | null };
type Store = { data: FoldersResponse | null; error: Error | null; loaded: boolean };

/** Shortens a home-directory path for display, e.g. `/Users/vikash/foo` -> `~/foo`. */
export function shortenHome(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

// One list for the whole page: every picker and the Settings section read it, and a refetch updates them all.
const EMPTY: Store = { data: null, error: null, loaded: false };
let store = EMPTY;
let inflight: Promise<FoldersResponse | null> | null = null;
const subscribers = new Set<() => void>();

function publish(next: Store) {
  store = next;
  subscribers.forEach((f) => f());
}

function refetch(): Promise<FoldersResponse | null> {
  inflight ??= fetch("/api/folders")
    .then(async (res) => {
      if (!res.ok) throw new Error("Failed to list folders");
      publish({ data: (await res.json()) as FoldersResponse, error: null, loaded: true });
    })
    .catch((e) => {
      console.error("Failed to list folders:", e);
      publish({ ...store, error: e instanceof Error ? e : new Error(String(e)), loaded: true });
    })
    .then(() => {
      inflight = null;
      return store.data;
    });
  return inflight;
}

function subscribe(f: () => void) {
  subscribers.add(f);
  return () => void subscribers.delete(f);
}

/** The folders this user may pick as a working folder, plus whether they may use host tools at all.
 *  `loaded` turns true after the first answer or error; `refetch` resolves with the fresh list. */
export function useFolders(enabled = true) {
  const s = useSyncExternalStore(subscribe, () => store, () => EMPTY);
  useEffect(() => {
    if (enabled) void refetch();
  }, [enabled]);
  return {
    folders: s.data?.folders ?? [],
    hostTools: s.data?.hostTools ?? false,
    reason: s.data?.reason ?? null,
    loaded: s.loaded,
    loading: !s.loaded,
    error: s.error,
    refetch,
  };
}
