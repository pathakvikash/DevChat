"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Clock, Loader2, X } from "lucide-react";
import { agentBadgeText, type AgentMessageData } from "@/lib/chat/agentMessages";

export interface QueuedItem {
  id: string;
  /** Client order: the server reads a chat's queue in this order. */
  seq: number;
  text: string;
  /** `failed`: the POST never reached the server, so the chip lives only here. `claimed`: a running step took it. */
  status: "queued" | "failed" | "claimed";
  /** An edit is being saved. */
  saving?: boolean;
  /** Set for an agent message from another chat: the chip shows who sent it. */
  agent?: AgentMessageData;
}

interface QueuedMessagesProps {
  items: QueuedItem[];
  toolsAvailable: boolean;
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  /** Focus goes here when the last chip is removed. */
  focusTextarea: () => void;
}

/** Messages typed during a reply, waiting for a step to take them (UX guide 3.6). */
export default function QueuedMessages({ items, toolsAvailable, onEdit, onRemove, onRetry, focusTextarea }: QueuedMessagesProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const count = useRef(0);

  // A new chip is scrolled into the tray, which may be full.
  useEffect(() => {
    if (items.length > count.current) {
      listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
    }
    count.current = items.length;
  }, [items.length]);

  if (items.length === 0) return null;

  // Focus moves to the next chip, else the previous one, else the textarea (UX guide 2.2).
  function removeAt(index: number) {
    const texts = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-queued-text]") ?? []);
    const next = texts[index + 1] ?? texts[index - 1];
    onRemove(items[index].id);
    if (next) next.focus();
    else focusTextarea();
  }

  return (
    <div>
      {items.length > 1 && (
        <div className="mb-2 flex items-center gap-1.5 text-[11px] text-zinc-400">
          <Clock size={11} /> Queued ({items.length})
          <span className="ml-auto">
            {toolsAvailable ? "the model sees these at its next step" : "sent when the reply finishes"}
          </span>
        </div>
      )}
      <div ref={listRef} role="list" aria-label="Queued messages" className="space-y-2">
        <AnimatePresence initial={false}>
          {items.map((item, index) => (
            <QueuedRow
              key={item.id}
              item={item}
              onEdit={onEdit}
              onRemove={() => removeAt(index)}
              onRetry={onRetry}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function QueuedRow({
  item,
  onEdit,
  onRemove,
  onRetry,
}: {
  item: QueuedItem;
  onEdit: (id: string, text: string) => void;
  onRemove: () => void;
  onRetry: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  // Enter, Esc and blur can all end one edit; only the first counts.
  const settled = useRef(true);
  const textRef = useRef<HTMLButtonElement>(null);
  const claimed = item.status === "claimed";
  const failed = item.status === "failed";

  function startEditing() {
    if (claimed) return;
    settled.current = false;
    setDraft(item.text);
    setEditing(true);
  }

  /** Enter and Esc keep the keyboard place on the chip; a blur does not take focus back. */
  function finishEditing(how: "save" | "cancel" | "blur") {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    if (how === "save" && draft.trim() && draft !== item.text) onEdit(item.id, draft);
    if (how !== "blur") requestAnimationFrame(() => textRef.current?.focus());
  }

  return (
    <motion.div
      role="listitem"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="overflow-hidden"
    >
      <div className={`group relative flex items-start gap-2 glass-card rounded-[var(--glass-radius-md)] px-3 py-2 pr-9 text-sm ${claimed ? "opacity-60" : ""}`}>
        {failed ? (
          <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0 text-amber-400" />
        ) : (
          <Clock size={14} aria-hidden className="mt-0.5 shrink-0 text-zinc-500" />
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <textarea
              autoFocus
              value={draft}
              rows={Math.min(4, Math.max(1, draft.split("\n").length))}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => finishEditing("blur")}
              onKeyDown={(e) => {
                // Esc cancels the edit and stops there: the global Esc (closing a dialog) must not also run.
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  finishEditing("cancel");
                } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  finishEditing("save");
                }
              }}
              aria-label="Edit queued message"
              className="glass-input w-full resize-none rounded-[var(--glass-radius-sm)] bg-transparent px-2 py-1 text-sm text-[var(--foreground)] outline-none"
            />
          ) : (
            <button
              ref={textRef}
              type="button"
              data-queued-text
              onClick={startEditing}
              aria-disabled={claimed}
              title={claimed ? undefined : "Edit queued message"}
              className="focus-ring block w-full text-left"
            >
              <span className="line-clamp-2 whitespace-pre-wrap break-words text-zinc-300">
                {item.agent && <span className="text-zinc-400">{`${agentBadgeText(item.agent, 32)}: `}</span>}
                {item.text}
              </span>
            </button>
          )}
          {claimed && <p className="mt-1 text-xs text-zinc-400">Sending…</p>}
          {failed && (
            <p className="mt-1 text-xs text-zinc-400">
              Not queued{" "}
              <button type="button" onClick={() => onRetry(item.id)} className="focus-ring ml-1 underline hover:text-[var(--foreground)]">
                Retry
              </button>
            </p>
          )}
        </div>
        <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
          {item.saving && (
            <Loader2 size={12} aria-label="Saving" className="animate-spin text-zinc-500 motion-reduce:animate-none" />
          )}
          {!claimed && (
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove queued message"
              title="Remove queued message"
              className="focus-ring flex h-6 w-6 items-center justify-center rounded-[var(--glass-radius-sm)] text-zinc-500 hover:bg-[var(--glass-bg-hover)] hover:text-[var(--foreground)]"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
