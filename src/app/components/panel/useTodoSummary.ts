"use client";

import { useEffect } from "react";
import { useResource } from "@/app/hooks/useResource";

interface TodoSummary {
  total: number;
  completed: number;
}

async function fetchSummary(conversationId: string): Promise<TodoSummary> {
  const res = await fetch(`/api/conversations/${conversationId}/todos?summary=true`);
  if (!res.ok) throw new Error(`Failed to fetch todo summary: ${res.status}`);
  return res.json();
}

/** Todo counts for the Activity badge; refreshed when the model or the Todos view changes them. */
export function useTodoSummary(conversationId: string, enabled: boolean) {
  const { data, refetch } = useResource<TodoSummary>(() => fetchSummary(conversationId), [conversationId], { enabled });
  useEffect(() => {
    const handler = () => void refetch();
    window.addEventListener("vas:todos-updated", handler);
    return () => window.removeEventListener("vas:todos-updated", handler);
  }, [refetch]);
  // Real numbers only: an odd payload must not show a badge.
  const total = typeof data?.total === "number" ? data.total : 0;
  const completed = typeof data?.completed === "number" ? data.completed : 0;
  return { total, completed, open: Math.max(0, total - completed) };
}
