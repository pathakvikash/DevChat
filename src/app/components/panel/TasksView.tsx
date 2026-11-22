"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, MessagesSquare, PanelRightOpen, Square, Hourglass, X, XCircle } from "lucide-react";
import SubAgentCard from "@/app/components/SubAgentCard";
import { useSplitViewOptional } from "@/app/c/SplitViewContext";
import { elapsed, runningCount, type BgTask } from "@/lib/chat/backgroundTasks";
import type { ToolPart } from "@/lib/utils/messageParts";
import { useTick } from "./useTick";

interface Props {
  tasks: BgTask[];
  messages: { role?: string; parts?: unknown }[];
  isLoading: boolean;
  /** The helper or queued message to scroll to (the URL's `item`). */
  item: string | null;
  onStopReply: () => void;
  onRemoveQueued: (id: string) => void;
  onStopAgents: () => void;
}

function StatusIcon({ status }: { status: BgTask["status"] }) {
  if (status === "running") return <Loader2 size={14} className="shrink-0 animate-spin text-blue-400" aria-hidden />;
  if (status === "queued") return <Hourglass size={14} className="shrink-0 text-zinc-400" aria-hidden />;
  if (status === "done") return <CheckCircle2 size={14} className="shrink-0 text-green-400" aria-hidden />;
  if (status === "error") return <XCircle size={14} className="shrink-0 text-red-400" aria-hidden />;
  if (status === "timeout") return <Clock size={14} className="shrink-0 text-amber-400" aria-hidden />;
  return <Square size={14} className="shrink-0 text-zinc-400" aria-hidden />;
}

const LABEL: Record<BgTask["status"], string> = { running: "Running", queued: "Queued", done: "Done", error: "Failed", stopped: "Stopped", timeout: "Timed out" };

/** The helper's tool part, for the existing SubAgentCard. */
function partOf(messages: Props["messages"], id: string): ToolPart | undefined {
  for (const m of messages) {
    if (!Array.isArray(m.parts)) continue;
    const hit = (m.parts as ToolPart[]).find((p) => p?.type === "tool-runAgent" && p.toolCallId === id);
    if (hit) return hit;
  }
  return undefined;
}

export default function TasksView({ tasks, messages, isLoading, item, onStopReply, onRemoveQueued, onStopAgents }: Props) {
  const split = useSplitViewOptional();
  const running = runningCount(tasks);
  const now = useTick(running > 0);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!item) return;
    document.getElementById(`task-${item}`)?.scrollIntoView({ block: "nearest" });
  }, [item, tasks.length]);

  if (tasks.length === 0) {
    return <p className="px-4 py-6 text-sm text-[var(--foreground)]/60">Nothing is running. Replies, helpers and queued messages show up here.</p>;
  }

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <ul className="space-y-2" aria-label="Background tasks">
        {tasks.map((t) => {
          const key = t.childId ?? t.id;
          const part = t.kind === "helper" ? partOf(messages, t.id) : undefined;
          const expanded = open[t.id] ?? false;
          const time = elapsed(t, now);
          return (
            <li
              key={t.id}
              id={`task-${key}`}
              data-task-kind={t.kind}
              data-task-status={t.status}
              className={`glass-card rounded-[var(--glass-radius-md)] px-3 py-2 ${item === key ? "ring-1 ring-[var(--glass-accent)]" : ""}`}
            >
              <div className="flex items-center gap-2 text-xs">
                {t.kind === "agent" ? <MessagesSquare size={14} className="shrink-0 text-blue-400" aria-hidden /> : <StatusIcon status={t.status} />}
                <span className="min-w-0 flex-1 truncate font-medium text-[var(--foreground)]" title={t.title}>{t.title}</span>
                <span className="shrink-0 font-mono tabular-nums text-[var(--foreground)]/60">{[LABEL[t.status], time].filter(Boolean).join(" · ")}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {t.kind === "reply" && isLoading && <TaskButton label="Stop" onClick={onStopReply} />}
                {t.kind === "helper" && t.status === "running" && <TaskButton label="Stop reply" title="Stops the whole reply, helpers included" onClick={onStopReply} />}
                {t.kind === "queued" && <TaskButton label="Remove" icon={<X size={12} aria-hidden />} onClick={() => onRemoveQueued(t.id)} />}
                {t.kind === "agent" && <TaskButton label="Stop" onClick={onStopAgents} />}
                {t.kind === "helper" && part && (
                  <TaskButton label={expanded ? "Hide details" : "Details"} onClick={() => setOpen((o) => ({ ...o, [t.id]: !expanded }))} />
                )}
                {t.kind === "helper" && t.childId && split && (
                  <TaskButton label="Open transcript" icon={<PanelRightOpen size={12} aria-hidden />} onClick={() => split.openSplit(t.childId!)} />
                )}
              </div>
              {expanded && part && <SubAgentCard part={part} isStreaming={t.status === "running"} onOpen={(id) => split?.openSplit(id)} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TaskButton({ label, onClick, icon, title }: { label: string; onClick: () => void; icon?: React.ReactNode; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} className="focus-ring inline-flex h-6 items-center gap-1 rounded-[var(--glass-radius-sm)] px-2 text-xs glass-button text-[var(--foreground)]">
      {icon}
      {label}
    </button>
  );
}
