"use client";

import { useState } from "react";
import { Loader2, Trash2, Sparkles, CheckCircle, AlertTriangle } from "lucide-react";
import SidePanel from "./ui/SidePanel";
import ErrorBanner from "./ui/ErrorBanner";
import AsyncButton from "./ui/AsyncButton";
import { useResource } from "@/app/hooks/useResource";
import ModelInfoSection from "./contextDetails/ModelInfoSection";
import TokenBreakdownSection, {
  type DetailedBreakdown,
} from "./contextDetails/TokenBreakdownSection";
import ContextUsageSection from "./contextDetails/ContextUsageSection";
import EstimatedCapacitySection from "./contextDetails/EstimatedCapacitySection";
import CompressedSummarySection from "./contextDetails/CompressedSummarySection";

interface ContextUsageData {
  usedTokens: number;
  maxContextTokens: number;
  contextPercent: number;
  breakdown: DetailedBreakdown & {
    sections?: {
      base: string;
      persona: string | null;
      skills: string | null;
      tools: string | null;
      memory: string | null;
      compressed: string | null;
      kb: string | null;
    };
  };
}

interface CompressionResult {
  summary: string;
  beforeTokens: number;
  afterTokens: number;
  beforeMessages: number;
  reductionTokens: number;
  reductionPercent: number;
}

interface ContextDetailsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  model: string;
  contextLength: number;
  currentMessage: string;
  messages: Array<{ role: string; content: string }>;
  enabledTools?: string[];
  enabledSkills?: string[];
  kbId?: string | null;
  hasCompressedSummary?: boolean;
  onCompressed?: (result: CompressionResult) => void;
  onCleared?: () => void;
}

export default function ContextDetailsPanel({
  isOpen,
  onClose,
  conversationId,
  model,
  contextLength,
  currentMessage,
  messages,
  enabledTools,
  enabledSkills,
  kbId,
  hasCompressedSummary,
  onCompressed,
  onCleared,
}: ContextDetailsPanelProps) {
  const [compressing, setCompressing] = useState(false);
  const [compressError, setCompressError] = useState<string | null>(null);
  const [compressResult, setCompressResult] = useState<CompressionResult | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const enabledToolsKey = (enabledTools ?? []).join(",");
  const enabledSkillsKey = (enabledSkills ?? []).join(",");

  const {
    data: usageData,
    loading,
    error: fetchError,
    refetch: refetchContextUsage,
  } = useResource<ContextUsageData>(
    async () => {
      const params = new URLSearchParams();
      params.set("currentMessage", currentMessage);
      if (enabledTools) params.set("enabledTools", JSON.stringify(enabledTools));
      if (enabledSkills) params.set("enabledSkills", JSON.stringify(enabledSkills));
      const res = await fetch(
        `/api/conversations/${conversationId}/context?${params.toString()}`,
      );
      if (!res.ok) throw new Error("Failed to fetch context usage");
      return res.json();
    },
    [conversationId, currentMessage, messages.length, enabledToolsKey, enabledSkillsKey],
    { enabled: isOpen, onError: () => {} },
  );
  const data = usageData;
  const error = fetchError?.message ?? null;

  async function handleCompress() {
    setCompressing(true);
    setCompressError(null);
    setCompressResult(null);
    try {
      const res = await fetch(
        `/api/conversations/${conversationId}/compress`,
        { method: "POST" },
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to compress conversation");
      }
      const result: CompressionResult = await res.json();
      setCompressResult(result);
      onCompressed?.(result);
      await refetchContextUsage();
    } catch (e: any) {
      setCompressError(e.message || "Failed to compress conversation");
    } finally {
      setCompressing(false);
    }
  }

  async function handleClearHistory() {
    if (clearing) return;
    const ok = confirm(
      "Clear all messages in this conversation? The conversation itself will be kept, but the history and any compression summary will be removed. This cannot be undone.",
    );
    if (!ok) return;
    setClearing(true);
    setClearError(null);
    setCompressError(null);
    try {
      const res = await fetch(
        `/api/conversations/${conversationId}/messages`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to clear history");
      }
      setCompressResult(null);
      onCleared?.();
      await refetchContextUsage();
    } catch (e: any) {
      setClearError(e.message || "Failed to clear history");
    } finally {
      setClearing(false);
    }
  }

  return (
    <SidePanel
      isOpen={isOpen}
      onClose={onClose}
      title="Context Details"
      subtitle="Token usage breakdown"
    >
      {loading ? (
        <div className="flex items-center gap-2 text-zinc-400">
          <Loader2 size={16} className="animate-spin" />
          Calculating token usage…
        </div>
      ) : error ? (
        <ErrorBanner>{error}</ErrorBanner>
      ) : data ? (
        <>
          <ModelInfoSection model={model} contextLength={contextLength} />

          <TokenBreakdownSection
            breakdown={data.breakdown}
            messageCount={messages.length}
            hasKb={!!kbId}
          />

          <ContextUsageSection
            usedTokens={data.usedTokens}
            maxContextTokens={data.maxContextTokens}
            contextPercent={data.contextPercent}
            contextLength={contextLength}
          />

          <EstimatedCapacitySection
            usedTokens={data.usedTokens}
            contextLength={contextLength}
            conversationHistoryTokens={data.breakdown.conversationHistory}
            messageCount={messages.length}
          />

          {data.contextPercent >= 85 && (
            <section className="bg-red-950/20 border border-red-900 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle
                  size={20}
                  className="text-red-400 shrink-0 mt-0.5"
                />
                <div>
                  <h4 className="font-medium text-red-300">Context Nearly Full</h4>
                  <p className="text-sm text-zinc-400 mt-1">
                    You're at {data.contextPercent}% capacity. Consider starting
                    a new conversation or enabling automatic summarization to
                    free up space.
                  </p>
                </div>
              </div>
            </section>
          )}

          {hasCompressedSummary && (
            <CompressedSummarySection
              compressResult={compressResult}
              conversationId={conversationId}
              onLoadSummary={refetchContextUsage}
            />
          )}

          <div className="flex gap-3 pt-4 border-t border-zinc-800">
            <AsyncButton
              onClick={handleClearHistory}
              loading={clearing}
              loadingText="Clearing…"
              icon={<Trash2 size={16} />}
              className="flex-1 px-4 py-2 text-sm font-medium text-zinc-300 glass-button rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Clear History
            </AsyncButton>
            <AsyncButton
              onClick={handleCompress}
              loading={compressing}
              loadingText="Compressing…"
              icon={compressResult ? <CheckCircle size={16} /> : <Sparkles size={16} />}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {compressResult
                ? `Compressed (-${compressResult.reductionPercent}%)`
                : "Summarize"}
            </AsyncButton>
          </div>
          {compressError && <ErrorBanner>{compressError}</ErrorBanner>}
          {clearError && <ErrorBanner>{clearError}</ErrorBanner>}
        </>
      ) : null}
    </SidePanel>
  );
}
