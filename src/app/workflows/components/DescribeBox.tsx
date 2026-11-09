"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import ModelSelector from "@/app/components/conversation/ModelSelector";
import { generateErrorMessage, previewLabel } from "@/lib/workflows/describe";
import type { WorkflowGraph } from "@/lib/workflows/graph";

export interface Proposal {
  graph: WorkflowGraph;
  warnings: string[];
}

/**
 * "Describe your flow" (7, 8.2): a strip above the cards. Expanded on an empty workflow, a collapsible strip otherwise.
 * It only asks for a proposal; the editor previews it, and nothing is saved until Apply. Leaving the page or pressing
 * Cancel (or Esc) aborts the request.
 */
export default function DescribeBox({
  workflowId,
  hasCards,
  defaultModel,
  hidden,
  beforeSend,
  onProposal,
}: {
  workflowId: string;
  /** The flow has cards beyond the trigger. */
  hasCards: boolean;
  defaultModel: string;
  /** A preview is showing: the box keeps its text and goes quiet. */
  hidden: boolean;
  /** Called before the request, so the server sees the cards as they are on screen. */
  beforeSend: () => Promise<void>;
  onProposal: (p: Proposal) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const expanded = open || !hasCards;

  useEffect(() => () => ctl.current?.abort(), []);
  useEffect(() => {
    if (error) retry.current?.focus();
  }, [error]);

  const send = useCallback(async () => {
    const description = text.trim();
    if (!description || ctl.current) return;
    const mine = new AbortController();
    ctl.current = mine;
    setBusy(true);
    setError(null);
    try {
      await beforeSend();
      const chosen = model ?? defaultModel;
      const res = await fetch("/api/workflows/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, workflowId, ...(chosen ? { model: chosen } : {}) }),
        signal: mine.signal,
      });
      const body = await res.json().catch(() => ({}));
      if (mine.signal.aborted || res.status === 499) return; // cancelled: nobody wants the answer
      if (!res.ok) setError(generateErrorMessage(res.status, body.error));
      else if (!Array.isArray(body.graph?.nodes)) setError(generateErrorMessage(502));
      else onProposal({ graph: body.graph, warnings: Array.isArray(body.warnings) ? body.warnings : [] });
    } catch {
      if (!mine.signal.aborted) setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      if (ctl.current === mine) ctl.current = null;
      setBusy(false);
    }
  }, [text, model, defaultModel, workflowId, beforeSend, onProposal]);

  const cancel = () => ctl.current?.abort();

  if (hidden) return null;

  if (!expanded) {
    return (
      <div className="border-b border-[var(--glass-border)] px-4 py-2">
        <button
          type="button"
          aria-expanded={false}
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => area.current?.focus());
          }}
          className="focus-ring glass-button inline-flex h-8 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-3 text-sm"
        >
          <ChevronRight size={14} aria-hidden="true" />
          <Sparkles size={14} aria-hidden="true" /> Describe your flow
        </button>
      </div>
    );
  }

  const empty = !hasCards;
  return (
    <section aria-label="Describe your flow" className={`border-b border-[var(--glass-border)] ${empty ? "px-4 py-6" : "px-4 py-3"}`}>
      <div className={`glass-card mx-auto space-y-3 rounded-[var(--glass-radius-lg)] p-4 ${empty ? "max-w-2xl" : "max-w-3xl"}`}>
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-zinc-300" aria-hidden="true" />
          <h2 className="flex-1 text-sm font-medium text-zinc-200">{empty ? "Describe what you want done and DevChat lays out the cards" : "Describe your flow"}</h2>
          {!empty && (
            <button type="button" aria-label="Collapse" title="Collapse" disabled={busy} onClick={() => setOpen(false)} className="focus-ring flex h-7 w-7 items-center justify-center rounded-[var(--glass-radius-sm)] text-zinc-400 hover:bg-[var(--glass-bg-hover)]">
              <ChevronDown size={14} />
            </button>
          )}
        </div>
        <textarea
          ref={area}
          aria-label="Describe your flow"
          rows={empty ? 4 : 3}
          value={text}
          readOnly={busy}
          maxLength={4000}
          placeholder={hasCards ? "Describe the change, for example: also save new jobs to a table" : "For example: every morning, search the web for news on my topics and write me a short digest"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter builds, Shift+Enter adds a line. Cmd/Ctrl+Enter is Run, so it does not reach the editor from here.
            if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            } else if (e.key === "Escape" && busy) {
              e.stopPropagation();
              cancel();
            }
          }}
          className="focus-ring glass-input w-full resize-y rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <ModelSelector currentModel={model ?? defaultModel} onModelChange={setModel} disabled={busy} size="sm" />
          <span className="text-xs text-zinc-400">Enter builds · Shift+Enter adds a line</span>
          <div className="ml-auto flex items-center gap-2">
            {busy && (
              <span role="status" className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
                <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Building your flow…
              </span>
            )}
            <button
              type="button"
              onClick={busy ? cancel : () => void send()}
              aria-disabled={!busy && !text.trim()}
              title={!busy && !text.trim() ? "Describe the flow first" : undefined}
              className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-3 text-sm font-medium ${busy ? "glass-button" : "glass-button-primary text-[var(--foreground)] aria-disabled:opacity-50"}`}
            >
              {busy ? "Cancel" : "Build flow"}
            </button>
          </div>
        </div>
        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[var(--glass-radius-md)] border border-red-900/50 px-3 py-2 text-sm text-zinc-200">
            <TriangleAlert size={14} className="shrink-0 text-red-400" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="font-medium">Failed.</span> {error}
            </span>
            <button ref={retry} type="button" onClick={() => void send()} className="focus-ring glass-button h-7 rounded-[var(--glass-radius-sm)] px-3 text-xs font-medium">
              Retry
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** The bar above a proposed flow: what it is, the warnings, and the two ways out. */
export function PreviewBar({ proposal, onApply, onDiscard }: { proposal: Proposal; onApply: () => void; onDiscard: () => void }) {
  const apply = useRef<HTMLButtonElement>(null);
  useEffect(() => apply.current?.focus(), []);
  return (
    <section aria-label="Proposed flow" className="border-b border-[var(--glass-border)] px-4 py-2" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onDiscard())}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-200">{previewLabel(proposal.graph)}</span>
        <span className="text-xs text-zinc-400">Nothing is saved until you apply it.</span>
        <div className="ml-auto flex items-center gap-2">
          <button ref={apply} type="button" onClick={onApply} className="focus-ring glass-button-primary h-8 rounded-[var(--glass-radius-md)] px-3 text-sm font-medium text-[var(--foreground)]">
            Apply
          </button>
          <button type="button" onClick={onDiscard} className="focus-ring glass-button h-8 rounded-[var(--glass-radius-md)] px-3 text-sm">
            Discard
          </button>
        </div>
      </div>
      {proposal.warnings.length > 0 && (
        <div className="mt-2 text-xs text-zinc-300">
          <p className="inline-flex items-center gap-1.5 font-medium">
            <TriangleAlert size={14} className="text-amber-400" aria-hidden="true" /> Check before you run
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-9">
            {proposal.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
