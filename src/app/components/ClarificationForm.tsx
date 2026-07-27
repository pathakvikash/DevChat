"use client";

import { useState, useCallback } from "react";
import { Check, Send } from "lucide-react";

interface ClarificationFormProps {
  question: string;
  type: "single" | "multi" | "text";
  options?: string[];
  recommended?: string;
  onAnswer: (answer: string) => void;
}

export default function ClarificationForm({
  question,
  type,
  options = [],
  recommended,
  onAnswer,
}: ClarificationFormProps) {
  const [selected, setSelected] = useState<string>(
    type === "single" ? recommended || "" : "",
  );
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [textInput, setTextInput] = useState("");

  const toggleMulti = useCallback((opt: string) => {
    setMultiSelected((prev) => {
      const next = new Set(prev);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    if (type === "single" && selected) {
      onAnswer(selected);
    } else if (type === "multi" && multiSelected.size > 0) {
      onAnswer(Array.from(multiSelected).join(", "));
    } else if (type === "text" && textInput.trim()) {
      onAnswer(textInput.trim());
    }
  }, [type, selected, multiSelected, textInput, onAnswer]);

  return (
    <div className="my-2 glass-card rounded-[var(--glass-radius-md)] overflow-hidden">
      <div className="px-4 py-3">
        <p className="text-sm text-zinc-200 mb-3">{question}</p>

        {type === "single" && (
          <div className="flex flex-wrap gap-2 mb-3">
            {options.map((opt) => (
              <button
                key={opt}
                onClick={() => setSelected(opt)}
                className={`px-3 py-1.5 rounded-[var(--glass-radius-md)] text-sm font-medium transition-all border ${
                  selected === opt
                    ? "glass-button-primary text-white"
                    : "glass-button text-zinc-300"
                } ${opt === recommended && selected !== opt ? "shadow-[var(--glass-shadow-glow)]" : ""}`}
              >
                {opt}
                {opt === recommended && (
                  <span className="ml-1.5 text-[10px] opacity-70">recommended</span>
                )}
              </button>
            ))}
          </div>
        )}

        {type === "multi" && (
          <div className="flex flex-wrap gap-2 mb-3">
            {options.map((opt) => {
              const isSel = multiSelected.has(opt);
              return (
                <button
                  key={opt}
                  onClick={() => toggleMulti(opt)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--glass-radius-md)] text-sm font-medium transition-all border ${
                    isSel
                      ? "glass-button-primary text-white"
                      : "glass-button text-zinc-300"
                  }`}
                >
                  {isSel && <Check size={12} />}
                  {opt}
                </button>
              );
            })}
          </div>
        )}

        {type === "text" && (
          <div className="mb-3">
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Type your answer..."
              rows={2}
              className="w-full resize-none glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
            />
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={
              (type === "single" && !selected) ||
              (type === "multi" && multiSelected.size === 0) ||
              (type === "text" && !textInput.trim())
            }
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-[var(--glass-radius-md)] text-sm font-medium glass-button-primary text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send size={14} />
            <span>
              {type === "multi"
                ? `Submit (${multiSelected.size} selected)`
                : "Submit"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
