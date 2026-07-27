"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface SystemPromptEditorProps {
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export default function SystemPromptEditor({
  value = "",
  onChange,
  disabled = false,
}: SystemPromptEditorProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="glass-card rounded-[var(--glass-radius-md)] overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        disabled={disabled}
        className="w-full px-4 py-2 glass-button text-[var(--foreground)] text-left text-sm flex items-center justify-between transition disabled:cursor-not-allowed"
      >
        <span>System Prompt</span>
        <ChevronDown
          size={16}
          className={`transition ${isExpanded ? "rotate-180" : ""}`}
        />
      </button>

      {isExpanded && (
        <div className="border-t border-[var(--glass-border)] p-4 bg-[var(--glass-bg)]">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder="You are a helpful AI assistant..."
            className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm resize-none disabled:cursor-not-allowed"
            rows={4}
          />
          <div className="mt-2 text-xs text-zinc-400">
            Define how the AI should behave in this conversation.
          </div>
        </div>
      )}
    </div>
  );
}
