"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

interface MessageEditorProps {
  initialContent: string;
  onSave: (newContent: string) => Promise<void> | void;
  onCancel: () => void;
  className?: string;
}

export default function MessageEditor({
  initialContent,
  onSave,
  onCancel,
  className = "",
}: MessageEditorProps) {
  const [value, setValue] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  }, []);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(value);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  };

  return (
    <div className={className}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        disabled={saving}
        rows={3}
        className="
          w-full min-h-[60px] resize-none rounded-[var(--glass-radius-md)] px-3 py-2 font-mono text-sm
          focus:outline-none focus:ring-1
          bg-white/10 border border-white/20 text-white placeholder-white/50 focus:ring-white/40 caret-white
        "
        placeholder="Edit your message..."
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-[var(--glass-radius-sm)] disabled:opacity-50 transition bg-white text-blue-700 hover:bg-white/90"
        >
          <Check size={12} />
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-[var(--glass-radius-sm)] disabled:opacity-50 transition bg-white/10 border border-white/20 text-white hover:bg-white/15"
        >
          <X size={12} />
          Cancel
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-white/50">
        Enter to save · Shift+Enter for newline · Esc to cancel
      </p>
    </div>
  );
}
