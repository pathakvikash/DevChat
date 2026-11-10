"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { CornerDownLeft, Square, X } from "lucide-react";
import type { QuoteCard } from "@/lib/utils/quoteReply";
import QueuedMessages, { type QueuedItem } from "@/app/components/QueuedMessages";

const LINE_PX = 24;
const MAX_LINES = 6;

interface SideComposerProps {
  /** The side chat's pane has focus when it mounts (⌘\ or /side): the box takes the cursor. */
  autoFocus?: boolean;
  input: string;
  setInput: (value: string) => void;
  parentTitle: string;
  isLoading: boolean;
  onSubmit: () => void;
  onStop: () => void;
  /** Enter while a reply runs: the message waits in the queue. */
  onQueue: () => void;
  queued: QueuedItem[];
  toolsAvailable: boolean;
  onQueueEdit: (id: string, text: string) => void;
  onQueueRemove: (id: string) => void;
  onQueueRetry: (id: string) => void;
  /** The one quote sent here from the main chat; it goes out with the message. */
  quote?: QuoteCard;
  onQuoteRemove: (id: string) => void;
}

/** The side chat's composer: one box, Enter sends, and it has none of the main composer's extras. */
export default function SideComposer({
  autoFocus = false,
  input,
  setInput,
  parentTitle,
  isLoading,
  onSubmit,
  onStop,
  onQueue,
  queued,
  toolsAvailable,
  onQueueEdit,
  onQueueRemove,
  onQueueRetry,
  quote,
  onQuoteRemove,
}: SideComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = input.trim().length > 0 || !!quote;

  // Grows with the text, up to MAX_LINES.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, LINE_PX * MAX_LINES)}px`;
  }, [input]);

  function focusTextarea() {
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (isLoading) {
      // Holding Enter queues once.
      if (!e.repeat) onQueue();
      return;
    }
    if (canSend) onSubmit();
  }

  return (
    <div className="px-3 pb-3">
      {queued.length > 0 && (
        <div className="mb-2 max-h-[min(30dvh,240px)] space-y-2 overflow-y-auto">
          <QueuedMessages
            items={queued}
            toolsAvailable={toolsAvailable}
            onEdit={onQueueEdit}
            onRemove={onQueueRemove}
            onRetry={onQueueRetry}
            focusTextarea={focusTextarea}
          />
        </div>
      )}
      <div className="rounded-[var(--glass-radius-lg)] border border-[var(--glass-border)] bg-white/[0.03] px-4 py-3">
        {quote && (
          <div className="relative mb-2 pr-8">
            <blockquote
              title={quote.text.slice(0, 300)}
              className="line-clamp-2 border-l-2 border-zinc-600 pl-2 text-xs italic text-zinc-400 whitespace-pre-wrap break-words"
            >
              {quote.text}
            </blockquote>
            <button
              type="button"
              onClick={() => {
                onQuoteRemove(quote.id);
                focusTextarea();
              }}
              aria-label="Remove quote"
              title="Remove quote"
              className="focus-ring absolute right-0 top-0 flex h-6 w-6 items-center justify-center rounded-[var(--glass-radius-sm)] text-zinc-500 hover:bg-[var(--glass-bg-hover)] hover:text-[var(--foreground)]"
            >
              <X size={12} />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            autoFocus={autoFocus}
            aria-label="Message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask about "${parentTitle}"…`}
            rows={1}
            style={{ maxHeight: `${LINE_PX * MAX_LINES}px` }}
            className="min-h-6 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent text-[15px] leading-6 text-[var(--foreground)] outline-none placeholder:text-zinc-500"
          />
          {isLoading ? (
            <button
              type="button"
              aria-label="Stop"
              title="Stop"
              onClick={() => {
                onStop();
                // Stop puts the undelivered text back in the box.
                focusTextarea();
              }}
              className="focus-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-full glass-button-danger text-red-200"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send"
              title="Send"
              disabled={!canSend}
              onClick={() => onSubmit()}
              className="focus-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-full glass-button-primary text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CornerDownLeft size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
