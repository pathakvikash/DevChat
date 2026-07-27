"use client";

import { useState } from "react";
import { Sparkles, ChevronDown, ChevronUp, TrendingDown, FileText } from "lucide-react";
import MarkdownMessage from "./MarkdownMessage";

interface CompressionEventProps {
  summary: string;
  compressedAt: string;
  beforeTokens?: number;
  afterTokens?: number;
  reductionPercent?: number;
  beforeMessages?: number;
}

export default function CompressionEvent({
  summary,
  compressedAt,
  beforeTokens,
  afterTokens,
  reductionPercent,
  beforeMessages,
}: CompressionEventProps) {
  const [expanded, setExpanded] = useState(false);
  const ts = new Date(compressedAt);
  const tsLabel = isNaN(ts.getTime())
    ? ""
    : ts.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

  return (
    <div className="my-4 flex justify-center">
      <div className="w-full max-w-2xl glass-card rounded-[var(--glass-radius-xl)] border border-emerald-900/60 overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--glass-bg-hover)] transition"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 w-8 h-8 rounded-full glass-strong border-emerald-700/50 flex items-center justify-center">
              <Sparkles size={14} className="text-emerald-300" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-emerald-200 flex items-center gap-2">
                Conversation compressed
                {typeof reductionPercent === "number" && reductionPercent > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs font-mono text-emerald-300 bg-emerald-900/50 px-1.5 py-0.5 rounded">
                    <TrendingDown size={10} />
                    -{reductionPercent}%
                  </span>
                )}
              </div>
              <div className="text-xs text-zinc-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {typeof beforeTokens === "number" && typeof afterTokens === "number" && (
                  <span className="font-mono">
                    {beforeTokens.toLocaleString()} → {afterTokens.toLocaleString()} tokens
                  </span>
                )}
                {typeof beforeMessages === "number" && beforeMessages > 0 && (
                  <span className="text-zinc-500">
                    · {beforeMessages} {beforeMessages === 1 ? "message" : "messages"} summarized
                  </span>
                )}
                {tsLabel && <span className="text-zinc-500">· {tsLabel}</span>}
              </div>
            </div>
          </div>
          <div className="shrink-0 text-zinc-500">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>

        {expanded && (
          <div className="border-t border-emerald-900/60 bg-[var(--glass-bg)]">
            <div className="px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-zinc-400 mb-2">
                <FileText size={12} />
                <span>Compressed summary</span>
              </div>
              <div className="max-h-64 overflow-y-auto glass rounded-[var(--glass-radius-md)] p-3 text-sm text-zinc-200 prose prose-invert prose-sm max-w-none">
                {summary ? (
                  <MarkdownMessage content={summary} />
                ) : (
                  <span className="text-zinc-500 italic">(no summary)</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
