"use client";

import SectionHeader from "../ui/SectionHeader";

interface EstimatedCapacitySectionProps {
  usedTokens: number;
  contextLength: number;
  conversationHistoryTokens: number;
  messageCount: number;
}

export default function EstimatedCapacitySection({
  usedTokens,
  contextLength,
  conversationHistoryTokens,
  messageCount,
}: EstimatedCapacitySectionProps) {
  const avgTokens =
    messageCount > 0
      ? Math.round(conversationHistoryTokens / messageCount)
      : null;
  const estMessages =
    messageCount > 0 && avgTokens !== null && avgTokens > 0
      ? Math.floor((contextLength - usedTokens) / avgTokens)
      : null;

  return (
    <section>
      <SectionHeader>Estimated Capacity</SectionHeader>
      <div className="glass-card rounded-[var(--glass-radius-lg)] p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-zinc-400">Remaining Tokens</span>
          <span className="text-emerald-400 font-mono">
            {(contextLength - usedTokens).toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-zinc-400">Avg Tokens/Message</span>
          <span className="text-white font-mono">
            {avgTokens !== null ? avgTokens : "N/A"}
          </span>
        </div>
        <div className="flex justify-between text-sm border-t border-[var(--glass-border)] pt-2">
          <span className="text-zinc-300">Est. Messages Remaining</span>
          <span className="text-white font-semibold">
            {estMessages !== null ? estMessages : "∞"}
          </span>
        </div>
      </div>
    </section>
  );
}
