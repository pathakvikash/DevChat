"use client";

import { useState } from "react";
import { ShieldQuestion } from "lucide-react";
import { useToolAnswers } from "./ToolAnswers";
import { approvalDetails, approvalTitle, CHAT_ALLOWABLE_TOOLS } from "@/lib/utils/messageParts";

/** Ask mode: a tool call waits here for Allow or Deny. Shown only in the latest message. */
export default function ApprovalCard({
  toolName,
  approvalId,
  input,
}: {
  toolName: string;
  approvalId: string;
  input: unknown;
}) {
  const answers = useToolAnswers();
  const [showAll, setShowAll] = useState(false);
  // One answer per card: a double click, or a second click while the reply resumes, does nothing.
  const [answered, setAnswered] = useState(false);
  const title = approvalTitle(toolName, input);
  const { block, description, rest } = approvalDetails(toolName, input);
  const answer = (approved: boolean, allowForChat = false) => {
    if (answered) return;
    setAnswered(true);
    answers?.answerApproval({ approvalId, toolName, approved, allowForChat });
  };
  const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent-strong)]";

  return (
    <div
      role="group"
      aria-label={`Needs your OK: ${title}`}
      className="my-2 glass-card rounded-[var(--glass-radius-md)] border border-amber-900/50 overflow-hidden"
    >
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--glass-bg-elevated)] text-xs">
        <ShieldQuestion size={14} className="text-amber-400 shrink-0" />
        <span className="font-medium text-zinc-200 truncate">Needs your OK</span>
        <span className="ml-auto text-zinc-400 shrink-0">Ask mode</span>
      </div>
      <div className="px-3 py-2">
        <p className="text-sm font-medium text-[var(--foreground)] break-words">{title}</p>
        {block.length > 0 && (
          <pre className="mt-1.5 max-h-64 overflow-auto rounded-sm text-xs font-mono text-zinc-200 whitespace-pre-wrap break-all">
            {block.map((l, n) => (
              <div
                key={n}
                className={l.tone === "add" ? "bg-emerald-500/10" : l.tone === "del" ? "bg-red-500/10" : l.tone === "muted" ? "text-zinc-400" : undefined}
              >
                {l.text}
              </div>
            ))}
          </pre>
        )}
        {description && (
          <p className="mt-1.5 text-xs text-zinc-400 whitespace-pre-wrap break-words">Model&apos;s description: {description}</p>
        )}
        {rest.length > 0 && (
          <dl className="mt-1.5 max-h-64 overflow-auto space-y-0.5">
            {rest.map(([k, v]) => (
              <div key={k} className="flex gap-2 min-w-0">
                <dt className="text-xs text-zinc-400 w-16 shrink-0 truncate">{k}</dt>
                <dd className="text-xs font-mono text-zinc-200 whitespace-pre-wrap break-all min-w-0">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className={`mt-1.5 text-xs text-zinc-400 hover:text-zinc-200 rounded-sm ${focus}`}
        >
          {showAll ? "▾ Hide arguments" : "› Show all arguments"}
        </button>
        {showAll && (
          <pre className="mt-1 max-h-64 overflow-auto text-xs font-mono text-zinc-300 whitespace-pre-wrap break-all">
            {JSON.stringify(input, null, 2)}
          </pre>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 px-3 py-2 border-t border-[var(--glass-border)]">
        <button type="button" disabled={answered} onClick={() => answer(false)} className={`h-8 px-3 text-xs rounded-[var(--glass-radius-sm)] glass-button ${focus}`}>
          Deny
        </button>
        {(!approvalId.startsWith("cli-") || CHAT_ALLOWABLE_TOOLS.has(toolName)) && (
          <button
            type="button"
            disabled={answered}
            onClick={() => answer(true, true)}
            title={`Don't ask again for ${toolName} in this chat`}
            className={`h-8 px-3 text-xs rounded-[var(--glass-radius-sm)] glass-button ${focus}`}
          >
            Allow for this chat
          </button>
        )}
        <button type="button" disabled={answered} onClick={() => answer(true)} className={`h-8 px-3 text-xs rounded-[var(--glass-radius-sm)] glass-button-primary text-[var(--foreground)] ${focus}`}>
          Allow
        </button>
      </div>
    </div>
  );
}
