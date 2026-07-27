"use client";

import { useState } from "react";
import {
  CheckCircle,
  Eye,
  EyeOff,
  TrendingDown,
  XCircle,
} from "lucide-react";
import AsyncButton from "../ui/AsyncButton";
import MarkdownMessage from "../MarkdownMessage";

interface CompressionResult {
  summary: string;
  beforeTokens: number;
  afterTokens: number;
  beforeMessages: number;
  reductionTokens: number;
  reductionPercent: number;
}

interface CompressedSummarySectionProps {
  compressResult: CompressionResult | null;
  conversationId: string;
  onLoadSummary: () => Promise<void>;
}

export default function CompressedSummarySection({
  compressResult,
  conversationId,
  onLoadSummary,
}: CompressedSummarySectionProps) {
  const [showSummary, setShowSummary] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(
    compressResult?.summary ?? null,
  );
  const [summaryLoading, setSummaryLoading] = useState(false);

  async function loadSummary() {
    if (summaryText) {
      setShowSummary((v) => !v);
      return;
    }
    setSummaryLoading(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`);
      if (res.ok) {
        const conv = await res.json();
        setSummaryText(conv.compressedSummary || "No summary available");
        setShowSummary(true);
      }
      await onLoadSummary();
    } finally {
      setSummaryLoading(false);
    }
  }

  return (
    <section className="bg-emerald-950/20 border border-emerald-900 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <CheckCircle
          size={20}
          className="text-emerald-400 shrink-0 mt-0.5"
        />
        <div>
          <h4 className="font-medium text-emerald-300">
            Conversation Compressed
          </h4>
          <p className="text-sm text-zinc-400 mt-1">
            A summary has been created and is being used to reduce context
            usage. The full history is preserved in the summary.
          </p>
        </div>
      </div>
      {compressResult && (
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-md border border-emerald-900/60 bg-emerald-950/40 p-3 text-center">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">
              Before
            </div>
            <div className="text-sm font-mono text-zinc-200">
              {compressResult.beforeTokens.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">
              After
            </div>
            <div className="text-sm font-mono text-zinc-200">
              {compressResult.afterTokens.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 flex items-center justify-center gap-1">
              <TrendingDown size={10} />
              Reduced
            </div>
            <div className="text-sm font-mono text-emerald-300 font-semibold">
              -{compressResult.reductionPercent}%
            </div>
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
        <span>
          {compressResult
            ? `${compressResult.beforeTokens.toLocaleString()} → ${compressResult.afterTokens.toLocaleString()} tokens (-${compressResult.reductionPercent}%)`
            : "Context reduced"}
        </span>
      </div>
      <AsyncButton
        onClick={loadSummary}
        loading={summaryLoading}
        loadingText="Loading…"
        icon={showSummary ? <EyeOff size={16} /> : <Eye size={16} />}
        className="mt-3 w-full px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition"
      >
        {showSummary ? "Hide Summary" : "View Summary"}
      </AsyncButton>

      {showSummary && summaryText && (
        <section className="mt-3 glass-card rounded-[var(--glass-radius-lg)] p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-zinc-200">
              Compressed Conversation Summary
            </h4>
            <button
              onClick={() => setShowSummary(false)}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <XCircle size={18} />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto text-sm text-zinc-200 prose prose-invert prose-sm max-w-none">
            <MarkdownMessage content={summaryText} />
          </div>
        </section>
      )}
    </section>
  );
}
