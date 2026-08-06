"use client";

import { MessageSquare, Target } from "lucide-react";
import type { ChatMode } from "./conversation/types";

const MODES = [
  {
    id: "chat" as const,
    label: "Chat",
    Icon: MessageSquare,
    hint: "Chat — read-only tools: web search, knowledge base, code execution, math",
  },
  {
    id: "agent" as const,
    label: "Agent",
    Icon: Target,
    hint: "Agent — read-only tools plus ones that write: artifacts, todos, memory, MCP servers",
  },
];

/** Chat/Agent switch — sidebar brand row (compact) and the conversation header. */
export default function ModeToggle({
  mode,
  onModeChange,
  disabled = false,
  compact = false,
}: {
  mode: ChatMode;
  onModeChange: (next: ChatMode) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Conversation mode"
      className={`flex items-center rounded-[var(--glass-radius-md)] glass-button ${compact ? "p-0.5" : "p-0.5"}`}
    >
      {MODES.map(({ id, label, Icon, hint }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={mode === id}
          onClick={() => onModeChange(id)}
          disabled={disabled}
          title={hint}
          className={`flex items-center gap-1.5 rounded-[calc(var(--glass-radius-md)-2px)] font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            compact ? "h-6 px-1.5 text-[10px]" : "h-7 px-2.5 text-xs"
          } ${
            mode === id
              ? "glass-button-primary text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Icon size={compact ? 11 : 13} />
          {/* Header is tight on mobile, so icons only there. */}
          <span className={compact ? undefined : "hidden sm:inline"}>{label}</span>
        </button>
      ))}
    </div>
  );
}
