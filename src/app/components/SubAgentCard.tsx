"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  PanelRightOpen,
  Pencil,
  Search,
  Square,
  Wrench,
  XCircle,
} from "lucide-react";
import type { ToolPart } from "@/lib/utils/messageParts";
import type { SubAgentOutput, SubAgentStep } from "@/lib/chat/subAgent";
import { useSplitViewOptional } from "@/app/c/SplitViewContext";

type View = "running" | "done" | "limit" | "error" | "timeout" | "stopped";

/** The card's state. A "running" output that is no longer streaming was stopped (Stop, or a reload). */
function viewOf(out: SubAgentOutput | undefined, part: ToolPart, live: boolean): View {
  if (!out) return part.state === "output-error" ? "error" : live ? "running" : "stopped";
  if (out.status === "running") return live ? "running" : "stopped";
  if (out.status === "done") return out.hitStepLimit ? "limit" : "done";
  return out.status;
}

const LABEL: Record<View, string> = {
  running: "Running",
  done: "Done",
  limit: "Stopped at the 15-step limit",
  error: "Failed",
  timeout: "Timed out after 5 min",
  stopped: "Stopped",
};

function StatusIcon({ view }: { view: View }) {
  if (view === "running") return <Loader2 size={14} className="animate-spin text-blue-400 shrink-0" />;
  if (view === "done" || view === "limit") return <CheckCircle2 size={14} className="text-green-400 shrink-0" />;
  if (view === "error") return <XCircle size={14} className="text-red-400 shrink-0" />;
  if (view === "timeout") return <Clock size={14} className="text-amber-400 shrink-0" />;
  return <Square size={14} className="text-zinc-400 shrink-0" />;
}

function StepIcon({ tool }: { tool: string }) {
  const cls = "text-zinc-500 shrink-0 mt-0.5";
  if (tool === "webSearch") return <Search size={12} className={cls} />;
  if (tool === "createArtifact" || tool === "updateArtifact") return <Pencil size={12} className={cls} />;
  if (tool.startsWith("read") || tool === "searchChats" || tool === "readChat") return <FileText size={12} className={cls} />;
  return <Wrench size={12} className={cls} />;
}

const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: "compact" }).format(n);
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function StepRow({ step }: { step: SubAgentStep }) {
  return (
    <li className="flex gap-2 text-xs">
      <StepIcon tool={step.tool} />
      <span className="min-w-0 truncate text-zinc-300" title={step.label}>{`${step.tool} ${step.label}`}</span>
      {step.state === "running" && <Loader2 size={12} className="ml-auto animate-spin text-blue-400 shrink-0" />}
      {step.state === "error" && <XCircle size={12} className="ml-auto text-red-400 shrink-0" />}
    </li>
  );
}

/** A `runAgent` helper in the parent's message (UX 3.11). Progress comes from the tool's preliminary outputs. */
export default function SubAgentCard({
  part,
  isStreaming = false,
  onOpen,
}: {
  part: ToolPart;
  isStreaming?: boolean;
  /** Defaults to opening the transcript as a read-only pane next to this chat (or `/c/<id>` outside split view). */
  onOpen?: (childId: string) => void;
}) {
  const router = useRouter();
  const split = useSplitViewOptional();
  const out = part.output as SubAgentOutput | undefined;
  const input = (part.input ?? {}) as { task?: string; title?: string };
  const view = viewOf(out, part, isStreaming);
  const running = view === "running";

  // Ticks once a second while running; the meta uses tabular numbers so the width holds.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  // Expanded by default only when the helper failed, so the partial notes show.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const expanded = userOpen ?? (view === "error" || view === "timeout");

  const title = out?.title || input.title || (input.task ?? "").slice(0, 60) || "Sub-agent";
  const brief = input.task ?? "";
  const endAt = out?.endedAt ?? (running ? now : undefined);
  const elapsed = out && endAt ? clock(endAt - out.startedAt) : undefined;
  const tokens = out?.usage ? `${compact(out.usage.inputTokens + out.usage.outputTokens)} tokens` : undefined;
  const meta = [out?.step ? `Step ${out.step}` : undefined, elapsed, tokens].filter(Boolean).join(" · ");
  const preview = out?.preview?.replace(/\s+/g, " ").slice(-160);
  const terminal = !running;

  return (
    <div role="group" aria-label={`Sub-agent: ${title}`} className="my-2 glass-card rounded-[var(--glass-radius-md)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--glass-bg-elevated)] text-xs">
        <button
          type="button"
          onClick={() => setUserOpen(!expanded)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown size={14} className="text-zinc-500 shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-zinc-500 shrink-0" />
          )}
          <StatusIcon view={view} />
          <span className="font-medium text-zinc-200 truncate">{title}</span>
        </button>
        <span
          aria-live={terminal ? "polite" : undefined}
          className="ml-auto shrink-0 whitespace-nowrap font-mono tabular-nums text-zinc-400"
        >
          {[LABEL[view], meta].filter(Boolean).join(" · ")}
        </span>
        {out?.childId && (
          <button
            type="button"
            title="Open transcript in side chat"
            onClick={() => {
              if (onOpen) onOpen(out.childId!);
              else if (split) split.openSplit(out.childId!);
              else router.push(`/c/${out.childId}`);
            }}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[var(--glass-radius-sm)] px-2 text-xs glass-button"
          >
            <PanelRightOpen size={12} />
            Open
          </button>
        )}
      </div>

      {brief && <div className="px-3 pt-2 text-xs text-zinc-400 truncate" title={brief}>{brief}</div>}
      {running && preview && <div className="px-3 pt-1 pb-2 text-xs italic text-zinc-400 truncate">{preview}</div>}
      {(out?.error && (view === "error" || view === "timeout")) && (
        <div className="px-3 pt-1 pb-2 text-xs text-zinc-300 break-words">{out.error}</div>
      )}

      {expanded && out && out.steps.length > 0 && (
        <ul className="max-h-60 overflow-y-auto space-y-1.5 px-3 pb-2 pt-1">
          {out.steps.map((step, i) => (
            <StepRow key={i} step={step} />
          ))}
        </ul>
      )}
    </div>
  );
}
