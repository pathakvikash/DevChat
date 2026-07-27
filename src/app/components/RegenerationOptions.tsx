"use client";

import { useState, useCallback } from "react";
import { RotateCcw, Brain, Globe, X } from "lucide-react";

type RegenerationMode = "retry" | "think" | "search";

interface RegenerationOptionsProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (mode: RegenerationMode, additionalInput: string) => void;
}

const OPTIONS: {
  mode: RegenerationMode;
  icon: typeof RotateCcw;
  title: string;
  description: string;
}[] = [
  {
    mode: "retry",
    icon: RotateCcw,
    title: "Try Again",
    description: "Regenerate as-is or with your additional instructions",
  },
  {
    mode: "think",
    icon: Brain,
    title: "Think Longer",
    description: "Model will reason more deeply before responding",
  },
  {
    mode: "search",
    icon: Globe,
    title: "Web Search",
    description: "Search the web first, then regenerate with fresh facts",
  },
];

export default function RegenerationOptions({
  isOpen,
  onClose,
  onExecute,
}: RegenerationOptionsProps) {
  const [selectedMode, setSelectedMode] = useState<RegenerationMode>("retry");
  const [additionalInput, setAdditionalInput] = useState("");

  const handleExecute = useCallback(() => {
    onExecute(selectedMode, additionalInput);
    setAdditionalInput("");
  }, [selectedMode, additionalInput, onExecute]);

  const handleClose = useCallback(() => {
    setAdditionalInput("");
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative glass-strong rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-100">
            Regenerate Response
          </h2>
          <button
            onClick={handleClose}
            className="rounded p-1 text-zinc-500 hover:text-zinc-300 glass-button transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-sm text-zinc-400 mb-1">
            How should the response change?
          </p>

          {OPTIONS.map(({ mode, icon: Icon, title, description }) => (
            <button
              key={mode}
              onClick={() => setSelectedMode(mode)}
              className={`w-full flex items-start gap-3 p-3 rounded-xl border transition-all text-left ${
                selectedMode === mode
                  ? "bg-blue-950/40 border-blue-700/50 ring-1 ring-blue-600/30"
                  : "glass-card border-zinc-700"
              }`}
            >
              <div
                className={`flex-shrink-0 mt-0.5 rounded-lg p-2 ${
                  selectedMode === mode
                    ? "bg-blue-600 text-white"
                    : "glass-strong text-zinc-400"
                }`}
              >
                <Icon size={16} />
              </div>
              <div>
                <div
                  className={`text-sm font-medium ${
                    selectedMode === mode ? "text-blue-200" : "text-zinc-200"
                  }`}
                >
                  {title}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  {description}
                </div>
              </div>
            </button>
          ))}

          <div className="pt-2">
            <label className="text-xs text-zinc-500 mb-1.5 block">
              Additional instructions (optional)
            </label>
            <textarea
              value={additionalInput}
              onChange={(e) => setAdditionalInput(e.target.value)}
              placeholder='e.g. "make it shorter", "more technical", "focus on the results"'
              rows={2}
              className="w-full resize-none glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zinc-800">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleExecute}
            className="px-5 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors"
          >
            {selectedMode === "retry" && "Regenerate"}
            {selectedMode === "think" && "Regenerate (Think Longer)"}
            {selectedMode === "search" && "Regenerate (Web Search)"}
          </button>
        </div>
      </div>
    </div>
  );
}
