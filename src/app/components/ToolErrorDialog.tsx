"use client";

import { useState } from "react";
import { AlertTriangle, X, Sparkles } from "lucide-react";
import CenteredDialog from "./ui/CenteredDialog";
import AsyncButton from "./ui/AsyncButton";

interface ToolErrorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onEnableChatOnlyMode: () => void;
  modelName: string;
}

export default function ToolErrorDialog({
  isOpen,
  onClose,
  onEnableChatOnlyMode,
  modelName,
}: ToolErrorDialogProps) {
  const [enabling, setEnabling] = useState(false);

  return (
    <CenteredDialog isOpen={isOpen} onClose={onClose}>
      <div>
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-full bg-amber-900/30 border border-amber-700 flex items-center justify-center">
            <AlertTriangle size={20} className="text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">
              Model doesn&apos;t support tools
            </h3>
            <p className="text-zinc-400 mt-1 text-sm">
              <code className="glass px-1.5 py-0.5 rounded text-xs font-mono">
                {modelName}
              </code>
              doesn&apos;t support tool calling (code execution, web search,
              etc.).
            </p>
            <p className="text-zinc-500 mt-2 text-sm">
              Switch to chat-only mode to continue chatting without tools. You
              can still write and explain code in markdown blocks.
            </p>
            <div className="flex gap-3 mt-4">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 text-sm font-medium text-zinc-300 glass-button rounded-[var(--glass-radius-md)]"
              >
                Cancel
              </button>
              <AsyncButton
                onClick={async () => {
                  setEnabling(true);
                  try {
                    await (onEnableChatOnlyMode as any)();
                  } finally {
                    setEnabling(false);
                  }
                }}
                loading={enabling}
                loadingText="Enabling…"
                icon={<Sparkles size={16} />}
                variant="primary"
                className="flex-1 px-4 py-2 text-sm font-medium"
              >
                Enable Chat-Only Mode
              </AsyncButton>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300"
          >
            <X size={20} />
          </button>
        </div>
      </div>
    </CenteredDialog>
  );
}
