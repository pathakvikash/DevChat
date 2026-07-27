"use client";

import { AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import SectionHeader from "../ui/SectionHeader";

interface ContextUsageSectionProps {
  usedTokens: number;
  maxContextTokens: number;
  contextPercent: number;
  contextLength: number;
}

function getStatus(percent: number): "healthy" | "warning" | "critical" {
  if (percent >= 85) return "critical";
  if (percent >= 60) return "warning";
  return "healthy";
}

function getStatusColor(status: "healthy" | "warning" | "critical"): string {
  switch (status) {
    case "healthy":
      return "emerald-500";
    case "warning":
      return "amber-500";
    case "critical":
      return "red-500";
  }
}

export default function ContextUsageSection({
  usedTokens,
  maxContextTokens,
  contextPercent,
  contextLength,
}: ContextUsageSectionProps) {
  const status = getStatus(contextPercent);
  const StatusIcon =
    contextPercent >= 85 ? XCircle : contextPercent >= 60 ? AlertTriangle : CheckCircle;
  const barColor =
    contextPercent >= 85
      ? "bg-red-500"
      : contextPercent >= 60
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <section>
      <SectionHeader>Context Usage</SectionHeader>
      <div className="glass-card rounded-[var(--glass-radius-lg)] p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-3xl font-bold text-white">
              {contextPercent}%
            </div>
            <div className="text-xs text-zinc-400">
              {usedTokens.toLocaleString()} / {maxContextTokens.toLocaleString()} tokens
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusIcon
              size={24}
              className={`text-${getStatusColor(status)}`}
            />
          </div>
        </div>
        <div className="w-full glass rounded-full h-3 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${barColor}`}
            style={{ width: `${Math.min(100, contextPercent)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-zinc-400 mt-1">
          <span>0</span>
          <span>{(contextLength / 2).toLocaleString()}</span>
          <span>{contextLength.toLocaleString()}</span>
        </div>
      </div>
    </section>
  );
}
