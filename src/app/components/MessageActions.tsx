"use client";

import { Copy, Edit, GitFork, Loader2, RotateCcw, Send, ThumbsUp, ThumbsDown, Trash2 } from "lucide-react";
import { createContext, useState, useCallback, useContext, useEffect, useRef } from "react";

export interface AgentSendValue {
  /** The other open chats. Empty hides the "Send to…" menu. */
  targets: { id: string; title: string }[];
  send: (targetId: string, text: string) => void;
}

/** Set by the pane: tool-less models get a "Send to…" menu on replies (UX 2.14). */
export const AgentSendContext = createContext<AgentSendValue | null>(null);

interface MessageActionsProps {
  messageId?: string;
  isUser: boolean;
  isStreaming: boolean;
  content: string;
  createdAt?: Date | string;
  initialFeedback?: number | null;
  onEdit?: (messageId: string, content: string) => Promise<void>;
  onDelete?: (messageId: string) => Promise<void>;
  onCopy?: (content: string) => void;
  onFork?: (messageId: string) => Promise<void>;
  onStartEditing: () => void;
  onRegenerateMessage?: (messageId: string) => void;
}

export default function MessageActions({
  messageId,
  isUser,
  isStreaming,
  content,
  createdAt,
  initialFeedback,
  onEdit,
  onDelete,
  onCopy,
  onFork,
  onStartEditing,
  onRegenerateMessage,
}: MessageActionsProps) {
  const [feedback, setFeedback] = useState<number | null>(initialFeedback ?? null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [forking, setForking] = useState(false);
  const [feedbackMenuOpen, setFeedbackMenuOpen] = useState(false);
  const feedbackMenuRef = useRef<HTMLDivElement>(null);
  const [sendMenuOpen, setSendMenuOpen] = useState(false);
  const sendMenuRef = useRef<HTMLDivElement>(null);
  const agentSend = useContext(AgentSendContext);

  useEffect(() => {
    if (!feedbackMenuOpen && !sendMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (feedbackMenuRef.current && !feedbackMenuRef.current.contains(e.target as Node)) {
        setFeedbackMenuOpen(false);
      }
      if (sendMenuRef.current && !sendMenuRef.current.contains(e.target as Node)) {
        setSendMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [feedbackMenuOpen, sendMenuOpen]);

  const handleFeedback = useCallback(async (rating: number) => {
    if (!messageId || feedbackLoading) return;
    setFeedbackLoading(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, rating }),
      });
      if (res.ok) {
        const data = await res.json();
        setFeedback(data.removed ? null : rating);
      }
    } catch {
    } finally {
      setFeedbackLoading(false);
    }
  }, [messageId, feedbackLoading]);

  const handleCopy = () => {
    const textToCopy = isUser ? content : stripThinkTags(content);
    if (onCopy) {
      onCopy(textToCopy);
    } else {
      navigator.clipboard.writeText(textToCopy);
    }
  };

  const handleFork = async () => {
    if (!messageId || !onFork || forking) return;
    setForking(true);
    try {
      await onFork(messageId);
    } finally {
      setForking(false);
    }
  };

  const handleDelete = async () => {
    if (!messageId || !onDelete) return;
    if (confirm("Are you sure you want to delete this message?")) {
      await onDelete(messageId);
    }
  };

  if (!messageId || (isStreaming && !isUser)) return null;

  return (
    <div
      className={`
        mt-1.5 flex select-none items-center gap-1
        ${isUser ? "justify-end" : "justify-start"}
        opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100
        transition-opacity duration-150
      `}
    >
      {createdAt && (
        <span className="text-[10px] text-zinc-500 mr-1">
          {getRelativeTime(createdAt)}
        </span>
      )}

      {!isUser && messageId && (
        <div className="relative" ref={feedbackMenuRef}>
          <button
            type="button"
            onClick={() => setFeedbackMenuOpen((v) => !v)}
            disabled={feedbackLoading}
            title="Rate response"
            aria-label="Rate response"
            aria-haspopup="menu"
            aria-expanded={feedbackMenuOpen}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs glass-button rounded-[var(--glass-radius-sm)] transition text-zinc-400 hover:text-zinc-100"
          >
            <ThumbsUp size={12} className={feedback === 1 ? "text-emerald-400" : ""} />
            <ThumbsDown size={12} className={feedback === -1 ? "text-red-400" : ""} />
          </button>

          {feedbackMenuOpen && (
            <div
              role="menu"
              className="absolute bottom-full left-0 mb-2 w-48 glass-panel-strong rounded-[var(--glass-radius-md)] shadow-lg border border-[var(--glass-border-strong)] z-[9999] overflow-hidden"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setFeedbackMenuOpen(false);
                  handleFeedback(1);
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-sm text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)] transition"
              >
                <ThumbsUp size={16} className={feedback === 1 ? "text-emerald-400" : ""} />
                <span>Good response</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setFeedbackMenuOpen(false);
                  handleFeedback(-1);
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-sm text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)] transition"
              >
                <ThumbsDown size={16} className={feedback === -1 ? "text-red-400" : ""} />
                <span>Bad response</span>
              </button>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={handleCopy}
        title="Copy"
        aria-label="Copy message"
        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 glass-button rounded-[var(--glass-radius-sm)] transition"
      >
        <Copy size={12} />
      </button>

      {!isUser && messageId && agentSend && agentSend.targets.length > 0 && (
        <div className="relative" ref={sendMenuRef}>
          <button
            type="button"
            onClick={() => setSendMenuOpen((v) => !v)}
            title="Send to…"
            aria-label="Send to another chat"
            aria-haspopup="menu"
            aria-expanded={sendMenuOpen}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 glass-button rounded-[var(--glass-radius-sm)] transition"
          >
            <Send size={12} />
          </button>
          {sendMenuOpen && (
            <div
              role="menu"
              aria-label="Send to another chat"
              className="absolute bottom-full left-0 mb-2 w-56 glass-panel-strong rounded-[var(--glass-radius-md)] shadow-lg border border-[var(--glass-border-strong)] z-[9999] overflow-hidden"
            >
              {agentSend.targets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="menuitem"
                  title={t.title}
                  onClick={() => {
                    setSendMenuOpen(false);
                    agentSend.send(t.id, stripThinkTags(content));
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)] transition"
                >
                  <Send size={14} className="shrink-0 text-zinc-400" />
                  <span className="truncate">{`Send to "${t.title}"`}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {onFork && messageId && (
        <button
          type="button"
          onClick={handleFork}
          disabled={forking}
          title="Fork from here"
          aria-label="Fork from here"
          className="focus-ring inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 glass-button rounded-[var(--glass-radius-sm)] transition"
        >
          {forking ? <Loader2 size={12} className="animate-spin" /> : <GitFork size={12} />}
        </button>
      )}

      {!isUser && onRegenerateMessage && messageId && (
        <button
          type="button"
          onClick={() => onRegenerateMessage(messageId!)}
          title="Regenerate"
          aria-label="Regenerate message"
          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 glass-button rounded-[var(--glass-radius-sm)] transition"
        >
          <RotateCcw size={12} />
        </button>
      )}

      {isUser && onEdit && (
        <button
          type="button"
          onClick={onStartEditing}
          title="Edit"
          aria-label="Edit message"
          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 glass-button rounded-[var(--glass-radius-sm)] transition"
        >
          <Edit size={12} />
        </button>
      )}

      {onDelete && (
        <button
          type="button"
          onClick={handleDelete}
          title="Delete"
          aria-label="Delete message"
          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-red-400 glass-button rounded-[var(--glass-radius-sm)] transition"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

export function getRelativeTime(date: Date | string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMon = Math.floor(diffDay / 30);
  if (diffMon < 12) return `${diffMon}mo ago`;
  return `${Math.floor(diffMon / 12)}y ago`;
}

function stripThinkTags(text: string): string {
  if (!text) return text;
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/, "")
    .trim();
}
