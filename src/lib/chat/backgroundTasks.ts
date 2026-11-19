/** What is going on in the background of a chat: its running reply, helpers, queued messages and an agent exchange. Pure, no React. */

import type { SubAgentOutput } from "@/lib/chat/subAgent";

export type TaskKind = "reply" | "helper" | "queued" | "agent";
export type TaskStatus = "running" | "queued" | "done" | "error" | "stopped" | "timeout";

export interface BgTask {
  id: string;
  kind: TaskKind;
  title: string;
  /** ms since epoch; null when unknown (queued messages carry no time). */
  startedAt: number | null;
  endedAt?: number;
  status: TaskStatus;
  /** Helpers: the sub-agent's transcript chat. */
  childId?: string;
}

interface MessageLike {
  id?: string;
  role?: string;
  parts?: unknown;
}

const isRunning = (t: BgTask) => t.status === "running" || t.status === "queued";
export const runningCount = (tasks: BgTask[]) => tasks.filter(isRunning).length;
export const finishedHelpers = (tasks: BgTask[]) => tasks.filter((t) => t.kind === "helper" && !isRunning(t));

/** A helper is "running" only while its message is streaming: a stored "running" output was stopped (same rule as SubAgentCard). */
function helperStatus(out: SubAgentOutput | undefined, state: string | undefined, live: boolean): TaskStatus {
  if (!out) return state === "output-error" ? "error" : live ? "running" : "stopped";
  if (out.status === "running") return live ? "running" : "stopped";
  return out.status === "done" ? "done" : out.status;
}

/** `replyStartedAt` is when the current reply began, which the messages do not record. */
export function tasksFrom(
  messages: MessageLike[],
  isLoading: boolean,
  queued: { id: string; text: string }[],
  talk?: { withTitle: string; hop: number },
  replyStartedAt: number | null = null,
): BgTask[] {
  const tasks: BgTask[] = [];
  if (isLoading) tasks.push({ id: "reply", kind: "reply", title: "Replying", startedAt: replyStartedAt, status: "running" });

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  for (const m of messages) {
    if (m.role !== "assistant" || !Array.isArray(m.parts)) continue;
    const live = isLoading && m === lastAssistant;
    for (const part of m.parts as { type?: string; toolCallId?: string; state?: string; input?: { task?: string; title?: string }; output?: SubAgentOutput }[]) {
      if (part?.type !== "tool-runAgent") continue;
      const out = part.output && typeof part.output === "object" ? part.output : undefined;
      tasks.push({
        id: part.toolCallId ?? `${m.id}-helper-${tasks.length}`,
        kind: "helper",
        title: out?.title || part.input?.title || (part.input?.task ?? "").slice(0, 60) || "Helper",
        startedAt: out?.startedAt ?? null,
        endedAt: out?.endedAt,
        status: helperStatus(out, part.state, live),
        childId: out?.childId,
      });
    }
  }

  for (const q of queued) tasks.push({ id: q.id, kind: "queued", title: q.text.slice(0, 80) || "Queued message", startedAt: null, status: "queued" });
  if (talk) tasks.push({ id: "agent-talk", kind: "agent", title: `Talking with ${talk.withTitle || "another chat"}`, startedAt: null, status: "running" });
  return tasks;
}

/** m:ss for a running or finished task; empty when the start is unknown. */
export function elapsed(task: BgTask, now: number): string {
  if (task.startedAt == null) return "";
  const s = Math.max(0, Math.floor(((task.endedAt ?? now) - task.startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
