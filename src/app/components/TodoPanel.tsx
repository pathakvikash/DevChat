"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
  ListTodo,
  RefreshCw,
} from "lucide-react";
import SidePanel from "./ui/SidePanel";
import { useResource } from "@/app/hooks/useResource";

interface TodoItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

interface TodoPanelProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  onRefresh?: () => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  high: "text-red-400",
  medium: "text-amber-400",
  low: "text-zinc-500",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  done: "Done",
  cancelled: "Cancelled",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 5000) return "just now";
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function fetchTodosList(conversationId: string): Promise<TodoItem[]> {
  const res = await fetch(`/api/conversations/${conversationId}/todos`);
  if (!res.ok) throw new Error(`Failed to fetch todos: ${res.status}`);
  const data = await res.json();
  return data.todos || [];
}

export default function TodoPanel({ isOpen, onClose, conversationId, onRefresh }: TodoPanelProps) {
  const [filter, setFilter] = useState<string>("all");
  const {
    data: todosData,
    loading,
    refetch: fetchTodos,
    setData: setTodos,
  } = useResource<TodoItem[]>(
    () => fetchTodosList(conversationId),
    [conversationId],
    { enabled: isOpen && !!conversationId },
  );
  const todos = todosData ?? [];

  useEffect(() => {
    if (!isOpen) return;
    const iv = setInterval(fetchTodos, 3000);
    return () => clearInterval(iv);
  }, [isOpen, fetchTodos]);

  const filtered = filter === "all"
    ? todos
    : filter === "active"
      ? todos.filter((t) => t.status === "pending" || t.status === "in_progress")
      : filter === "done"
        ? todos.filter((t) => t.status === "done")
        : todos.filter((t) => t.status === filter);

  async function handleStatusChange(todoId: string, newStatus: string) {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/todos`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ todoId, status: newStatus }),
      });
      if (res.ok) {
        setTodos((prev) =>
          (prev ?? []).map((t) => (t.id === todoId ? { ...t, status: newStatus, updatedAt: new Date().toISOString() } : t)),
        );
        onRefresh?.();
      }
    } catch (e) {
      console.error("Failed to update todo:", e);
    }
  }

  const doneCount = todos.filter((t) => t.status === "done").length;
  const activeCount = todos.filter((t) => t.status === "pending" || t.status === "in_progress").length;
  const total = todos.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <SidePanel
      isOpen={isOpen}
      onClose={onClose}
      title="Todos"
      subtitle={`${activeCount} active · ${doneCount} done · ${total} total`}
      widthClass="max-w-md"
    >
      {loading && todos.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-zinc-500" />
        </div>
      )}

      {!loading && todos.length === 0 && (
        <div className="text-center py-12 text-zinc-500 text-sm">
          <ListTodo size={32} className="mx-auto mb-3 opacity-40" />
          <p>No todos yet.</p>
          <p className="mt-1 text-xs text-zinc-600">
            Ask the AI to plan a multi-step task — it will create todos automatically.
          </p>
        </div>
      )}

      {todos.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
              <div
                className={`h-full rounded-full transition-all ${
                  pct === 100 ? "bg-emerald-500" : pct > 50 ? "bg-blue-500" : "bg-amber-500"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[11px] text-zinc-500">{pct}%</span>
            <button
              onClick={fetchTodos}
              className="p-1 rounded glass-button text-zinc-500 transition"
              title="Refresh"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          <div className="flex gap-1 border-b border-[var(--glass-border)] pb-2">
            {["all", "active", "done"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 text-xs rounded-full transition ${
                  filter === f
                    ? "glass-strong text-[var(--foreground)]"
                    : "text-zinc-400 glass-button"
                }`}
              >
                {f === "all" ? "All" : f === "active" ? "Active" : "Done"}
                <span className="ml-1 text-[10px] opacity-60">
                  {f === "all" ? total : f === "active" ? activeCount : doneCount}
                </span>
              </button>
            ))}
          </div>

          <ul className="space-y-1.5">
            {filtered.map((t) => (
              <li
                key={t.id}
                className={`flex items-start gap-2 px-2 py-2 rounded-lg transition ${
                  t.status === "done"
                    ? "glass"
                    : t.status === "in_progress"
                      ? "bg-blue-950/20 border border-blue-900/30"
                      : "hover:glass"
                }`}
              >
                <button
                  onClick={() => {
                    const next = t.status === "done" ? "pending" : "done";
                    handleStatusChange(t.id, next);
                  }}
                  className="mt-0.5 shrink-0"
                  title={t.status === "done" ? "Mark pending" : "Mark done"}
                >
                  {t.status === "done" ? (
                    <CheckCircle2 size={16} className="text-emerald-400" />
                  ) : t.status === "in_progress" ? (
                    <Loader2 size={16} className="animate-spin text-blue-400" />
                  ) : t.status === "cancelled" ? (
                    <AlertTriangle size={16} className="text-zinc-500" />
                  ) : (
                    <Circle size={16} className="text-zinc-600 hover:text-zinc-400" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm ${
                        t.status === "done" || t.status === "cancelled"
                          ? "text-zinc-500 line-through"
                          : "text-zinc-200"
                      }`}
                    >
                      {t.title}
                    </span>
                    {t.priority !== "medium" && (
                      <span className={`text-[10px] font-medium ${PRIORITY_COLORS[t.priority] || "text-zinc-500"}`}>
                        {t.priority}
                      </span>
                    )}
                  </div>
                  {t.description && (
                    <p className="text-[11px] text-zinc-500 mt-0.5">{t.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      t.status === "done"
                        ? "bg-emerald-950/40 text-emerald-400"
                        : t.status === "in_progress"
                          ? "bg-blue-950/40 text-blue-400"
                          : t.status === "cancelled"
                            ? "glass text-zinc-500"
                            : "glass text-zinc-400"
                    }`}>
                      {STATUS_LABEL[t.status] || t.status}
                    </span>
                    <span className="text-[10px] text-zinc-600">
                      {timeAgo(t.updatedAt)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </SidePanel>
  );
}
