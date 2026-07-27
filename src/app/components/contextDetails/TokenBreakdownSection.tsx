"use client";

import SectionHeader from "../ui/SectionHeader";

export interface DetailedBreakdown {
  base: number;
  persona: number;
  skills: number;
  tools: number;
  memory: number;
  compressed: number;
  kb: number;
  conversationHistory: number;
  currentMessage: number;
  total: number;
}

interface Row {
  label: string;
  tokens: number;
  hint?: string;
  emphasize?: boolean;
}

interface TokenBreakdownSectionProps {
  breakdown: DetailedBreakdown;
  messageCount: number;
  hasKb: boolean;
}

export default function TokenBreakdownSection({
  breakdown,
  messageCount,
  hasKb,
}: TokenBreakdownSectionProps) {
  const rows: Row[] = [
    {
      label: "System Prompt (base)",
      tokens: breakdown.base,
      hint: "pinned — sent on every turn",
      emphasize: true,
    },
    {
      label: "Persona / Custom Instructions",
      tokens: breakdown.persona,
      hint: breakdown.persona ? undefined : "none set",
    },
    {
      label: "Skills",
      tokens: breakdown.skills,
      hint: breakdown.skills ? undefined : "none active",
    },
    {
      label: "Tool Descriptions",
      tokens: breakdown.tools,
      hint: breakdown.tools ? undefined : "only built-ins (no extras)",
    },
    {
      label: "Memory",
      tokens: breakdown.memory,
      hint: breakdown.memory ? undefined : "no saved memories",
    },
    {
      label: "Compressed History",
      tokens: breakdown.compressed,
      hint: breakdown.compressed ? undefined : "no compression",
    },
    {
      label: "KB Auto-Injected",
      tokens: breakdown.kb,
      hint: hasKb
        ? breakdown.kb
          ? undefined
          : "no chunks fit the budget"
        : "no KB attached",
    },
    {
      label: "Conversation History",
      tokens: breakdown.conversationHistory,
      hint: `${messageCount} message${messageCount === 1 ? "" : "s"}`,
    },
    {
      label: "Current Message",
      tokens: breakdown.currentMessage,
    },
  ];

  return (
    <section>
      <SectionHeader>Token Breakdown</SectionHeader>
      <div className="space-y-1.5 glass-card rounded-[var(--glass-radius-lg)] p-4">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex justify-between text-sm"
          >
            <span className="text-zinc-400 flex items-center gap-2">
              {row.label}
              {row.hint && (
                <span className="text-xs text-zinc-500">({row.hint})</span>
              )}
            </span>
            <span
              className={
                row.emphasize
                  ? "text-amber-300 font-mono"
                  : "text-white font-mono"
              }
            >
              {row.tokens.toLocaleString()}
            </span>
          </div>
        ))}
        <div className="flex justify-between text-sm border-t border-[var(--glass-border)] pt-2 mt-2 font-semibold">
          <span className="text-zinc-300">Total</span>
          <span className="text-white font-mono">
            {breakdown.total.toLocaleString()}
          </span>
        </div>
      </div>
    </section>
  );
}
