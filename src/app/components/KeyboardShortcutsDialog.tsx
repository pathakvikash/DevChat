"use client";

import { Keyboard, X } from "lucide-react";

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["Cmd", "K"], description: "Open command palette" },
    ],
  },
  {
    title: "Chat",
    shortcuts: [
      { keys: ["Cmd", "Enter"], description: "Send message (from any focus)" },
      { keys: ["Enter"], description: "Send message" },
      { keys: ["Shift", "Enter"], description: "Newline" },
    ],
  },
  {
    title: "Commands",
    shortcuts: [
      { keys: ["Cmd", "/"], description: "Toggle keyboard shortcuts" },
      { keys: ["Escape"], description: "Close dialog" },
    ],
  },
  {
    title: "Tools",
    shortcuts: [
      { keys: ["↑"], description: "Navigate command autocomplete" },
      { keys: ["↓"], description: "Navigate command autocomplete" },
    ],
  },
];

interface KeyboardShortcutsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function KeyboardShortcutsDialog({
  isOpen,
  onClose,
}: KeyboardShortcutsDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg glass-strong rounded-xl shadow-2xl p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--glass-border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg glass-strong flex items-center justify-center">
              <Keyboard size={16} className="text-zinc-300" />
            </div>
            <h2 className="text-base font-semibold text-white">
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition p-1 rounded glass-button"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4 space-y-5">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2.5">
                {group.title}
              </h3>
              <div className="space-y-1">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.keys.join("+")}
                    className="flex items-center justify-between py-1.5"
                  >
                    <span className="text-sm text-zinc-300">
                      {shortcut.description}
                    </span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, i) => (
                        <span key={key}>
                          <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-xs font-medium text-zinc-200 glass-strong border border-[var(--glass-border)] rounded">
                            {key}
                          </kbd>
                          {i < shortcut.keys.length - 1 && (
                            <span className="text-zinc-600 mx-0.5 text-xs">
                              +
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-[var(--glass-border)] glass">
          <p className="text-xs text-zinc-500">
            Press <kbd className="inline-flex items-center justify-center h-5 px-1 text-xs font-medium text-zinc-300 glass-strong border border-[var(--glass-border)] rounded">Cmd</kbd> + <kbd className="inline-flex items-center justify-center h-5 px-1 text-xs font-medium text-zinc-300 glass-strong border border-[var(--glass-border)] rounded">/</kbd> to toggle this dialog at any time
          </p>
        </div>
      </div>
    </div>
  );
}
