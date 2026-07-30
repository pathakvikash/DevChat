"use client";

import { ListTodo } from "lucide-react";
import { useEffect } from "react";
import { useResource } from "@/app/hooks/useResource";

interface TodoIndicatorProps {
  conversationId: string;
  onOpen: () => void;
}

interface TodoSummary {
  total: number;
  completed: number;
}

async function fetchTodoSummary(conversationId: string): Promise<TodoSummary> {
  const res = await fetch(`/api/conversations/${conversationId}/todos?summary=true`);
  if (!res.ok) throw new Error(`Failed to fetch todo summary: ${res.status}`);
  return res.json();
}

export default function TodoIndicator({
  conversationId,
  onOpen,
}: TodoIndicatorProps) {
  const { data: summary, refetch: fetchSummary } = useResource<TodoSummary>(
    () => fetchTodoSummary(conversationId),
    [conversationId],
    { enabled: !!conversationId },
  );

  useEffect(() => {
    const handler = () => fetchSummary();
    window.addEventListener("vas:todos-updated", handler);
    return () => window.removeEventListener("vas:todos-updated", handler);
  }, [fetchSummary]);

  if (!summary || summary.total === 0) return null;

  const pct = summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0;

  return (
    <button
      onClick={onOpen}
      className="absolute top-2 right-2 z-10 flex items-center gap-2 rounded-[var(--glass-radius-md)] glass-button px-2.5 py-1.5 text-xs text-zinc-300 shadow-lg transition hover:text-[var(--foreground)]"
    >
      <ListTodo size={14} />
      <span>{summary.completed}/{summary.total}</span>
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </button>
  );
}
