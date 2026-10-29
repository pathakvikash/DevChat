"use client";

import { AlertTriangle, X } from "lucide-react";
import type { PaneWarning } from "./SplitViewContext";

interface PaneBarProps {
  title: string;
  focused: boolean;
  onClose?: () => void;
  warning?: PaneWarning | null;
  onWarningClick?: () => void;
}

/** Compact header for a pane when two or more are open: title, close, and the two-writer warning. */
export default function PaneBar({ title, focused, onClose, warning, onWarningClick }: PaneBarProps) {
  return (
    <div className="glass-nav relative z-20 flex shrink-0 flex-col gap-1 px-3 py-2">
      <div className="flex h-8 items-center gap-2">
        <span
          title={title}
          className={`min-w-0 flex-1 truncate text-sm font-semibold ${focused ? "text-[var(--foreground)]" : "text-zinc-400"}`}
        >
          {title}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            title="Close pane"
            className="flex size-7 shrink-0 items-center justify-center rounded-[var(--glass-radius-sm)] text-zinc-400 hover:text-[var(--foreground)]"
          >
            <X size={16} />
          </button>
        )}
      </div>
      {warning && (
        <button
          type="button"
          onClick={onWarningClick}
          title={`"${warning.otherTitle}" is in ${warning.mode} mode on ${warning.folder}. Click to go to it.`}
          className="inline-flex items-center gap-1 self-start text-[11px] text-zinc-400 hover:text-[var(--foreground)]"
        >
          <AlertTriangle size={12} className="text-amber-400" />
          Another open chat can edit this folder
        </button>
      )}
    </div>
  );
}
