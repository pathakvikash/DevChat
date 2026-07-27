"use client";

import { useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";

interface ThinkingBlockProps {
  text: string;
}

export default function ThinkingBlock({ text }: ThinkingBlockProps) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="my-2 glass rounded-[var(--glass-radius-md)] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-[var(--glass-bg-hover)] transition"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Brain size={14} className="text-purple-400" />
        <span className="font-medium">Thinking</span>
        <span className="text-zinc-500 ml-1">
          {open ? "(hide)" : `(${text.length} chars)`}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 text-xs text-zinc-400 whitespace-pre-wrap border-t border-[var(--glass-border)]">
          {text}
        </div>
      )}
    </div>
  );
}
