"use client";

import { useEffect, useState, useRef } from "react";

interface ContextUsageCircleProps {
  usedTokens: number;
  maxContextTokens: number;
  contextPercent: number;
  onClick?: () => void;
  className?: string;
}

export default function ContextUsageCircle({
  usedTokens,
  maxContextTokens,
  contextPercent,
  onClick,
  className = "",
}: ContextUsageCircleProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const circleRef = useRef<HTMLButtonElement>(null);
  const r = 14;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (contextPercent / 100) * circumference;

  const colorClass =
    contextPercent < 70
      ? "stroke-emerald-400"
      : contextPercent < 90
        ? "stroke-amber-400"
        : "stroke-red-400";

  return (
    <div className={`relative ${className}`}>
      <button
        ref={circleRef}
        onClick={onClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className="group relative flex items-center justify-center w-10 h-10 rounded-full glass-button"
      >
        <svg width="36" height="36" className="absolute">
          <circle
            cx="18"
            cy="18"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="text-[var(--glass-border)]"
          />
          <circle
            cx="18"
            cy="18"
            r={r}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            className={`transition-all duration-500 ${colorClass}`}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90, 18, 18)"
          />
        </svg>
        <span className="text-[9px] font-bold text-zinc-300 z-10">
          {Math.round(contextPercent)}
        </span>
      </button>

      {showTooltip && (
        <div className="absolute bottom-full right-0 mb-2 w-64 glass-panel rounded-[var(--glass-radius-md)] p-3 shadow-lg z-50 animate-in fade-in-0 zoom-in-95">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-300">Context Usage</span>
            <span
              className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                contextPercent < 70
                  ? "glass-strong text-emerald-300"
                  : contextPercent < 90
                    ? "glass-strong text-amber-300"
                    : "glass-strong text-red-300"
              }`}
            >
              {contextPercent.toFixed(0)}%
            </span>
          </div>
          <div className="w-full glass rounded-full h-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                contextPercent < 70
                  ? "bg-emerald-500"
                  : contextPercent < 90
                    ? "bg-amber-500"
                    : "bg-red-500"
              }`}
              style={{ width: `${Math.min(contextPercent, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-zinc-500 mt-1.5">
            <span>{usedTokens.toLocaleString()} used</span>
            <span>{maxContextTokens.toLocaleString()} max</span>
          </div>
        </div>
      )}
    </div>
  );
}
