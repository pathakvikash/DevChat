"use client";

import { useEffect } from "react";
import { useResource } from "./useResource";
import type { AppRecord } from "@/lib/apps/types";

export async function fetchApps(): Promise<AppRecord[]> {
  const res = await fetch("/api/apps");
  if (!res.ok) throw new Error(`Failed to load apps (${res.status})`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.apps ?? [];
}

/** Apps for the signed-in user; `apps` holds the approved ones. Refetches when the window regains focus. */
export function useApps() {
  const r = useResource<AppRecord[]>(fetchApps, []);
  const { refetch } = r;
  useEffect(() => {
    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetch]);
  return { ...r, apps: (r.data ?? []).filter((a) => a.approved !== false) };
}
