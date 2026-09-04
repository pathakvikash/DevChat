"use client";

interface TypingIndicatorProps {
  isVisible: boolean;
  /** What is happening right now, e.g. "Waiting for Claude Code…" or "Running Read…". */
  label?: string;
  /** Inline inside a bubble (no outer padding). */
  compact?: boolean;
}

export default function TypingIndicator({ isVisible, label = "AI is thinking…", compact = false }: TypingIndicatorProps) {
  if (!isVisible) return null;

  return (
    <div className={`flex items-center gap-2 text-sm text-zinc-400 ${compact ? "" : "px-4 py-2"}`}>
      <div className="flex gap-1">
        <div className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.3s]" />
        <div className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.15s]" />
        <div className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce" />
      </div>
      <span>{label}</span>
    </div>
  );
}
