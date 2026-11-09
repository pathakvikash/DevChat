"use client";

import { Circle, CheckCircle2, CircleAlert, CircleSlash, Loader2, ShieldQuestion, Square, XCircle, RotateCcw } from "lucide-react";
import type { CardRun, RunState } from "@/lib/workflows/graph";

export type DisplayStatus = "notrun" | "running" | "done" | "failed" | "skipped" | "waiting" | "cancelled" | "interrupted";

// Colour marks the icon only; the word always sits beside it (UX 0.2).
export const STATUS_META: Record<DisplayStatus, { label: string; Icon: typeof Circle; color: string }> = {
  notrun: { label: "Not run", Icon: Circle, color: "text-zinc-500" },
  running: { label: "Running", Icon: Loader2, color: "text-blue-400 animate-spin" },
  done: { label: "Done", Icon: CheckCircle2, color: "text-green-400" },
  failed: { label: "Failed", Icon: XCircle, color: "text-red-400" },
  skipped: { label: "Skipped", Icon: CircleSlash, color: "text-zinc-400" },
  waiting: { label: "Waiting for you", Icon: ShieldQuestion, color: "text-amber-400" },
  cancelled: { label: "Cancelled", Icon: Square, color: "text-zinc-400" },
  interrupted: { label: "Interrupted", Icon: CircleAlert, color: "text-amber-400" },
};

export const runStatus = (state: RunState): DisplayStatus => (state === "succeeded" ? "done" : state);

/** A card's status in a run. A card still `running` in a run that ended was stopped with it. */
export function cardStatus(card: CardRun | undefined, runState?: RunState): DisplayStatus {
  if (!card) return "notrun";
  if (card.status === "succeeded") return "done";
  if (card.status === "running" && runState && runState !== "running" && runState !== "waiting") return runState === "cancelled" ? "cancelled" : "interrupted";
  return card.status;
}

export function StatusBadge({ status }: { status: DisplayStatus }) {
  const { label, Icon, color } = STATUS_META[status];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-zinc-400">
      <Icon size={14} className={color} aria-hidden="true" />
      {label}
    </span>
  );
}

export function formatDuration(startedAt?: string | Date | null, endedAt?: string | Date | null): string {
  if (!startedAt) return "";
  const secs = Math.max(0, Math.round(((endedAt ? new Date(endedAt).getTime() : Date.now()) - new Date(startedAt).getTime()) / 1000));
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** "9 Nov 14:02" */
export function formatRunDate(d: string | Date): string {
  return new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

export interface RunRow {
  id: string;
  state: RunState;
  trigger: string;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export function ResumeButton({ onClick, at }: { onClick: () => void; at?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={at ? `The server stopped during this run. Resume picks up at “${at}”.` : "Resume this run"}
      className="focus-ring glass-button inline-flex h-8 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-3 text-sm font-medium"
    >
      <RotateCcw size={14} aria-hidden="true" />
      Resume
    </button>
  );
}
