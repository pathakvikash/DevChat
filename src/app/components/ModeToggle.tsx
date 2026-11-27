"use client";

import { useEffect, useId, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { MoreHorizontal } from "lucide-react";
import { modeSegment, segmentToMode, toggleConfirm, togglePlan, type ChatMode, type ModeSegment } from "@/lib/chat/modes";
import { useToast } from "@/app/components/Toast";

/** The copy for Agent when the model can't use tools. */
const NEEDS_TOOLS = "Needs a model that can use tools. Pick one with the wrench icon.";

const SEGMENTS: { id: ModeSegment; label: string; hint: string }[] = [
  { id: "ask", label: "Ask", hint: "Ask: answers, with read-only tools (web search, knowledge base, code run)" },
  { id: "agent", label: "Agent", hint: "Agent: makes changes (artifacts, todos, memory, MCP, files)" },
];

/** Ask | Agent switch under the composer, plus a small menu for "Confirm each change" and "Plan first". */
export default function ModeToggle({
  mode,
  onModeChange,
  disabled = false,
  toolsAvailable = true,
}: {
  mode: ChatMode;
  onModeChange: (next: ChatMode) => void;
  disabled?: boolean;
  /** False for a model without tools: Agent stays visible but blocked. */
  toolsAvailable?: boolean;
}) {
  const { toast } = useToast();
  const pillId = useId();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The options popover closes on a press outside it, or on Escape (focus returns to its button).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const active = modeSegment(mode);
  const blocked = (id: ModeSegment) => !toolsAvailable && id === "agent";
  // Confirming changes needs tools; Plan first does not.
  const pick = (next: ChatMode) => (!toolsAvailable && next === "ask" ? toast(NEEDS_TOOLS, "info") : onModeChange(next));

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const to = active === "ask" ? 1 : 0;
    if (blocked(SEGMENTS[to].id)) return;
    onModeChange(segmentToMode(SEGMENTS[to].id, mode));
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[to]?.focus();
  };

  return (
    <div ref={rootRef} className="relative flex items-center gap-1">
      <div
        role="radiogroup"
        aria-label="Conversation mode"
        onKeyDown={onKeyDown}
        className="flex items-center rounded-[var(--glass-radius-md)] glass-button p-0.5"
      >
        {SEGMENTS.map(({ id, label, hint }) => {
          const isBlocked = blocked(id);
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active === id}
              tabIndex={active === id || (active === null && id === "ask") ? 0 : -1}
              aria-label={label}
              // aria-disabled, not disabled: the tooltip and the tap toast still work.
              aria-disabled={isBlocked || undefined}
              onClick={() => (isBlocked ? toast(NEEDS_TOOLS, "info") : onModeChange(segmentToMode(id, mode)))}
              disabled={disabled}
              title={isBlocked ? NEEDS_TOOLS : hint}
              className={`relative h-7 px-2.5 text-xs font-medium rounded-[calc(var(--glass-radius-md)-2px)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent-strong)] disabled:opacity-50 disabled:cursor-not-allowed ${
                isBlocked ? "opacity-50 cursor-not-allowed" : ""
              } ${active === id ? "text-white" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {active === id && (
                <motion.span
                  layoutId={pillId}
                  aria-hidden="true"
                  className="glass-button-primary absolute inset-0 rounded-[inherit]"
                  transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
                />
              )}
              <span className="relative">{label}</span>
            </button>
          );
        })}
      </div>
      {mode === "plan" && <span className="text-xs text-blue-300" data-testid="mode-plan-label">Plan</span>}
      <button
        ref={triggerRef}
        type="button"
        aria-label="Mode options"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex h-7 w-7 items-center justify-center rounded-[var(--glass-radius-md)] text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-2 w-60 max-w-[calc(100vw-2rem)] rounded-[var(--glass-radius-md)] glass-strong p-2 text-xs text-zinc-200 shadow-lg">
          <label className="flex cursor-pointer items-start gap-2 p-1.5" title="Agent waits for Allow or Deny before each change">
            <input type="checkbox" checked={mode === "ask"} onChange={() => pick(toggleConfirm(mode))} className="mt-0.5" />
            <span>Confirm each change</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 p-1.5" title="Researches, then proposes a plan for you to approve. Changes nothing.">
            <input type="checkbox" checked={mode === "plan"} onChange={() => pick(togglePlan(mode))} className="mt-0.5" />
            <span>Plan first</span>
          </label>
        </div>
      )}
    </div>
  );
}
