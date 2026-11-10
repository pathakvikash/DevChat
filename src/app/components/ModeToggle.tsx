"use client";

import { ListChecks, MessageSquare, ShieldQuestion, Target } from "lucide-react";
import type { ChatMode } from "@/lib/chat/modes";
import { useToast } from "@/app/components/Toast";

/** UX 2.6: the copy for Ask and Agent when the model can't use tools. */
const NEEDS_TOOLS = "Needs a model that can use tools. Pick one with the wrench icon.";

const MODES = [
  {
    id: "chat" as const,
    label: "Chat",
    Icon: MessageSquare,
    hint: "Chat: answers, with read-only tools (web search, knowledge base, code run)",
  },
  {
    id: "plan" as const,
    label: "Plan",
    Icon: ListChecks,
    hint: "Plan: researches, then proposes a plan for you to approve. Changes nothing.",
  },
  {
    id: "ask" as const,
    label: "Ask",
    Icon: ShieldQuestion,
    hint: "Ask: can make changes, but asks before each one",
  },
  {
    id: "agent" as const,
    label: "Agent",
    Icon: Target,
    hint: "Agent: makes changes without asking (artifacts, todos, memory, MCP, files)",
  },
];

/** Chat · Plan · Ask · Agent switch: sidebar brand row (compact, icons only) and the conversation header. */
export default function ModeToggle({
  mode,
  onModeChange,
  disabled = false,
  compact = false,
  toolsAvailable = true,
}: {
  mode: ChatMode;
  onModeChange: (next: ChatMode) => void;
  disabled?: boolean;
  compact?: boolean;
  /** False for a model without tools: Ask and Agent stay visible but blocked (UX 2.6). */
  toolsAvailable?: boolean;
}) {
  const { toast } = useToast();
  const blockedMode = (id: ChatMode) => !toolsAvailable && (id === "ask" || id === "agent");

  // One tab stop (the checked segment); Left and Right move and select, skipping blocked modes (UX 3.10).
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : -1;
    let i = MODES.findIndex((m) => m.id === mode);
    for (let n = 0; n < MODES.length; n++) {
      i = (i + step + MODES.length) % MODES.length;
      if (!blockedMode(MODES[i].id)) break;
    }
    if (blockedMode(MODES[i].id)) return;
    onModeChange(MODES[i].id);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[i]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Conversation mode"
      onKeyDown={onKeyDown}
      className="flex items-center rounded-[var(--glass-radius-md)] glass-button p-0.5"
    >
      {MODES.map(({ id, label, Icon, hint }) => {
        const blocked = blockedMode(id);
        const title = blocked ? NEEDS_TOOLS : hint;
        return (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={mode === id}
          tabIndex={mode === id ? 0 : -1}
          aria-label={label}
          // aria-disabled, not disabled: the tooltip and the tap toast still work.
          aria-disabled={blocked || undefined}
          onClick={() => (blocked ? toast(NEEDS_TOOLS, "info") : onModeChange(id))}
          disabled={disabled}
          title={title}
          className={`flex items-center gap-1.5 rounded-[calc(var(--glass-radius-md)-2px)] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent-strong)] disabled:opacity-50 disabled:cursor-not-allowed ${
            blocked ? "opacity-50 cursor-not-allowed" : ""
          } ${
            compact ? "h-6 px-1.5" : "h-7 px-2.5 text-xs"
          } ${
            mode === id
              ? "glass-button-primary text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Icon size={compact ? 11 : 13} />
          {/* Header is tight on mobile, so icons only there. The compact toggle is icons only too. */}
          {!compact && <span className="hidden sm:inline">{label}</span>}
        </button>
        );
      })}
    </div>
  );
}
