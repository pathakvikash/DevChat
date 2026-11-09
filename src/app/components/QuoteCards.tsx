"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mic, MessageSquarePlus, TextQuote, X } from "lucide-react";
import type { QuoteCard } from "@/lib/utils/quoteReply";
import { sendShortcutLabel } from "@/lib/utils/platform";

interface QuoteCardsProps {
  quotes: QuoteCard[];
  onChange: (id: string, instruction: string) => void;
  onRemove: (id: string) => void;
  /** Cmd/Ctrl+Enter in a card: send only that card. */
  onSendOne: (id: string) => void;
  /** Enter in a card: send everything. */
  onSendAll: (e: React.KeyboardEvent) => void;
  focusTextarea: () => void;
  /** A reply is running: Cmd/Ctrl+Enter waits until it ends. */
  busy: boolean;
  /** The card whose instruction is being dictated, if any. */
  listeningId?: string | null;
  /** Mic button on each card. Left out where voice isn't supported. */
  onDictate?: (id: string) => void;
  /** Moves a card to the side chat. Left out where no side chat can open. */
  onSideChat?: (id: string) => void;
}

/** Quote cards for the composer tray (UX guide 2.2 / 3.1). */
export default function QuoteCards({
  quotes,
  onChange,
  onRemove,
  onSendOne,
  onSendAll,
  focusTextarea,
  busy,
  listeningId = null,
  onDictate,
  onSideChat,
}: QuoteCardsProps) {
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const added = useRef<string | null>(null);
  const prevCount = useRef(0);

  // A new card takes focus, so Reply → type → Enter needs no mouse.
  useEffect(() => {
    if (quotes.length > prevCount.current) {
      added.current = quotes[quotes.length - 1].id;
      inputs.current[added.current]?.focus();
    }
    prevCount.current = quotes.length;
  }, [quotes]);

  // After a card leaves, focus goes to the next card, else (on remove, not on send) the previous, else the textarea.
  function focusNeighbour(index: number, orPrevious: boolean) {
    const next = quotes[index + 1] ?? (orPrevious ? quotes[index - 1] : undefined);
    requestAnimationFrame(() => (next ? inputs.current[next.id]?.focus() : focusTextarea()));
  }

  if (quotes.length === 0) return null;

  return (
    <div>
      {quotes.length > 1 && (
        <div className="mb-2 flex items-center gap-1.5 text-[11px] text-zinc-400">
          <TextQuote size={11} /> Quotes ({quotes.length})
        </div>
      )}
      <div role="list" aria-label="Quotes" className="space-y-2">
        <AnimatePresence initial={false}>
          {quotes.map((q, i) => (
            <motion.div
              key={q.id}
              role="listitem"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              // Once it has grown to full height, bring a new card fully into the scrolling tray.
              onAnimationComplete={() => {
                if (added.current !== q.id) return;
                added.current = null;
                inputs.current[q.id]?.closest('[role="listitem"]')?.scrollIntoView({ block: "nearest" });
              }}
              className="overflow-hidden"
            >
              <div className="group relative flex items-start gap-2 glass-card rounded-[var(--glass-radius-md)] px-3 py-2 text-sm focus-within:border-[var(--glass-accent)]!"
                style={{ paddingRight: 8 + 28 * (1 + (onDictate ? 1 : 0) + (onSideChat ? 1 : 0)) }}>
                <TextQuote size={14} className="mt-0.5 shrink-0 text-zinc-500" />
                <div className="min-w-0 flex-1">
                  <blockquote
                    title={q.text.slice(0, 300)}
                    className="line-clamp-2 border-l-2 border-zinc-600 pl-2 text-xs italic text-zinc-400 whitespace-pre-wrap break-words md:line-clamp-3"
                  >
                    {q.text}
                  </blockquote>
                  <input
                    ref={(el) => {
                      inputs.current[q.id] = el;
                    }}
                    type="text"
                    value={q.instruction}
                    onChange={(e) => onChange(q.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        focusTextarea();
                      } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        if (e.metaKey || e.ctrlKey) {
                          if (!busy && !e.repeat) {
                            onSendOne(q.id);
                            focusNeighbour(i, false);
                          }
                        } else {
                          onSendAll(e);
                        }
                      }
                    }}
                    placeholder="Add an instruction (optional)"
                    aria-label={`Instruction for quote ${i + 1}`}
                    className="mt-1.5 w-full bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-zinc-500"
                  />
                  <p className="mt-1 hidden text-[11px] text-zinc-400 group-focus-within:md:block">
                    {sendShortcutLabel()} this quote · ↵ all
                  </p>
                </div>
                <div className="absolute right-1.5 top-1.5 flex gap-1">
                  {onDictate && (
                    <button
                      type="button"
                      onClick={() => onDictate(q.id)}
                      aria-label={`Dictate into quote ${i + 1}`}
                      aria-pressed={listeningId === q.id}
                      title={listeningId === q.id ? "Stop dictation" : "Dictate instruction"}
                      className={`focus-ring flex h-6 w-6 items-center justify-center rounded-[var(--glass-radius-sm)] ${
                        listeningId === q.id
                          ? "glass-button-primary text-white"
                          : "text-zinc-500 hover:bg-[var(--glass-bg-hover)] hover:text-[var(--foreground)]"
                      }`}
                      style={listeningId === q.id ? { animation: "mic-pulse 2s ease-in-out infinite" } : undefined}
                    >
                      <Mic size={14} className={listeningId === q.id ? "animate-pulse" : undefined} />
                    </button>
                  )}
                  {onSideChat && (
                    <button
                      type="button"
                      onClick={() => onSideChat(q.id)}
                      aria-label={`Ask quote ${i + 1} in a side chat`}
                      title="Ask in a side chat"
                      className="focus-ring flex h-6 w-6 items-center justify-center rounded-[var(--glass-radius-sm)] text-zinc-500 hover:bg-[var(--glass-bg-hover)] hover:text-[var(--foreground)]"
                    >
                      <MessageSquarePlus size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      onRemove(q.id);
                      focusNeighbour(i, true);
                    }}
                    aria-label={`Remove quote ${i + 1}`}
                    title={`Remove quote ${i + 1}`}
                    className="focus-ring flex h-6 w-6 items-center justify-center rounded-[var(--glass-radius-sm)] text-zinc-500 hover:bg-[var(--glass-bg-hover)] hover:text-[var(--foreground)]"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
