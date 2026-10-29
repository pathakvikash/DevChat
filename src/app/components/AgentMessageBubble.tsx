"use client";

import type { ReactNode } from "react";
import { Bot } from "lucide-react";
import {
  agentBadgeText,
  MAX_AGENT_HOPS,
  type AgentMessageData,
} from "@/lib/chat/agentMessages";

const BADGE_TITLE_MAX = 32;

/** A message another chat sent: right-aligned, neutral card, labelled with its sender (UX 3.12). */
export function AgentMessageBubble({
  sender,
  children,
}: {
  sender: Pick<AgentMessageData, "from" | "fromTitle">;
  children: ReactNode;
}) {
  return (
    <div className="flex justify-end">
      <div className="glass-card text-[var(--foreground)] rounded-[var(--glass-radius-xl)] px-4 py-3 w-fit max-w-[85%] min-w-0">
        <div
          title={agentBadgeText(sender)}
          className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400"
        >
          <Bot size={12} className="shrink-0" />
          <span>{agentBadgeText(sender, BADGE_TITLE_MAX)}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Shown in the two panes of an agent exchange: dots, who they talk with, the hop count, and Stop. */
export function AgentTalkingRow({
  withTitle,
  hop,
  maxHops = MAX_AGENT_HOPS,
  onStop,
}: {
  withTitle: string;
  hop: number;
  maxHops?: number;
  onStop: () => void;
}) {
  const name = withTitle.trim() || "another chat";
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-400">
      <div className="flex shrink-0 gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 animate-bounce" />
      </div>
      <span className="min-w-0 truncate">{`Talking with "${name}" · ${hop} of ${maxHops}`}</span>
      <button
        type="button"
        onClick={onStop}
        className="glass-button-danger ml-auto h-7 shrink-0 px-2.5 text-xs"
      >
        Stop
      </button>
    </div>
  );
}
