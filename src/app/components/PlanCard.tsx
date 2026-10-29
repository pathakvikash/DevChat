"use client";

import { useState } from "react";
import { CheckCircle2, ListChecks } from "lucide-react";
import type { PlanDecision, ToolPart } from "@/lib/utils/messageParts";
import { useToolAnswers } from "./ToolAnswers";

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent-strong)]";
const RUN_IN = [
  { id: "ask" as const, label: "Ask" },
  { id: "agent" as const, label: "Agent" },
];

/** The plan the model made with `presentPlan`. Approve picks Ask or Agent; Revise sends feedback. */
export default function PlanCard({ part }: { part: ToolPart }) {
  const answers = useToolAnswers();
  const input = part.input ?? {};
  const steps: string[] = Array.isArray(input.steps) ? input.steps.map(String) : [];
  const title = typeof input.title === "string" && input.title ? input.title : "Plan";
  const [runIn, setRunIn] = useState<"ask" | "agent">("ask");
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");
  // One answer per card: a double click does nothing the second time.
  const [decided, setDecided] = useState(false);
  const waiting = part.state === "input-available";
  const streaming = part.state === "input-streaming";
  const decision = part.output as PlanDecision | undefined;
  const approvedIn = decision?.action === "approve" ? decision.mode : undefined;
  const revision = decision?.action === "revise" ? decision.feedback : undefined;

  if (part.state === "output-denied") {
    return (
      <div role="group" aria-label={`Plan: ${title}`} className="my-2 glass-card rounded-[var(--glass-radius-md)] overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--glass-bg-elevated)] text-xs text-zinc-400">
          <ListChecks size={14} className="shrink-0" />
          <span className="truncate">Plan · {title}</span>
          <span className="ml-auto shrink-0">{part.approval?.reason ?? "Replaced by a newer plan"}</span>
        </div>
      </div>
    );
  }

  if (!waiting) {
    return (
      <div role="group" aria-label={`Plan: ${title}`} className="my-2 glass-card rounded-[var(--glass-radius-md)] overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--glass-bg-elevated)] text-xs">
          {approvedIn ? <CheckCircle2 size={14} className="text-green-400 shrink-0" /> : <ListChecks size={14} className="text-blue-400 shrink-0" />}
          <span className="font-medium text-zinc-200 truncate">Plan · {title}</span>
          <span className="ml-auto text-zinc-400 shrink-0">
            {approvedIn
              ? `Approved · running in ${approvedIn === "agent" ? "Agent" : "Ask"} mode`
              : revision !== undefined ? "Revising" : streaming ? "Writing the plan…" : `${steps.length} steps`}
          </span>
        </div>
        {revision && <p className="px-3 py-2 text-xs text-zinc-400 whitespace-pre-wrap break-words">{revision}</p>}
      </div>
    );
  }

  const approve = () => {
    if (decided) return;
    setDecided(true);
    answers?.answerPlan({ toolCallId: part.toolCallId ?? "", approve: true, mode: runIn });
  };
  const sendRevision = () => {
    if (!feedback.trim() || decided) return;
    setDecided(true);
    answers?.answerPlan({ toolCallId: part.toolCallId ?? "", approve: false, feedback: feedback.trim() });
  };

  return (
    <div role="group" aria-label={`Plan: ${title}`} className="my-2 glass-card rounded-[var(--glass-radius-md)] border border-amber-900/50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--glass-bg-elevated)] text-xs">
        <ListChecks size={14} className="text-blue-400 shrink-0" />
        <span className="font-medium text-zinc-200 truncate">Plan · {title}</span>
        <span className="ml-auto text-zinc-400 shrink-0">{steps.length} steps</span>
      </div>
      <div className="px-3 py-2">
        <ol className="list-decimal pl-5 space-y-1.5 text-sm text-[var(--foreground)]">
          {steps.map((step, i) => (
            <li key={i} className="break-words">{step}</li>
          ))}
        </ol>
        {typeof input.notes === "string" && input.notes && (
          <p className="mt-2 text-xs text-zinc-400 whitespace-pre-wrap">{input.notes}</p>
        )}
        {revising && (
          <textarea
            autoFocus
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendRevision();
            }}
            placeholder="Say what to change in the plan"
            aria-label="What to change in the plan"
            rows={2}
            className="glass-input mt-2 w-full resize-none rounded-[var(--glass-radius-sm)] px-2 py-1.5 text-sm"
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-[var(--glass-border)]">
        <span className="text-xs text-zinc-400">Run in</span>
        <div role="radiogroup" aria-label="Run the plan in" className="flex items-center rounded-[var(--glass-radius-sm)] glass-button p-0.5">
          {RUN_IN.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={runIn === id}
              onClick={() => setRunIn(id)}
              className={`h-6 px-2 text-xs rounded-[calc(var(--glass-radius-sm)-2px)] ${focus} ${runIn === id ? "glass-button-primary text-[var(--foreground)]" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {revising ? (
            <button type="button" onClick={sendRevision} disabled={!feedback.trim() || decided} className={`h-8 px-3 text-xs rounded-[var(--glass-radius-sm)] glass-button-primary text-[var(--foreground)] disabled:opacity-50 ${focus}`}>
              Send revision
            </button>
          ) : (
            <button type="button" onClick={() => setRevising(true)} disabled={decided} className={`h-8 px-3 text-xs rounded-[var(--glass-radius-sm)] glass-button disabled:opacity-50 ${focus}`}>
              Revise
            </button>
          )}
          <button type="button" onClick={approve} disabled={decided} className={`h-8 px-3 text-xs rounded-[var(--glass-radius-sm)] glass-button-primary text-[var(--foreground)] disabled:opacity-50 ${focus}`}>
            Approve plan
          </button>
        </div>
      </div>
    </div>
  );
}
