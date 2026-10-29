"use client";

import SendToMainButton from "@/app/components/sidechat/SendToMainButton";
import { joinTextParts } from "@/lib/utils/conversation";
import { memo, useEffect, useRef } from "react";
import { UIMessage } from "ai";
import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";
import QuoteReplyPill from "./QuoteReplyPill";
import { splitAtQueuedMessages } from "@/lib/chat/normalizeToolParts";
import { settleStaleParts } from "@/lib/utils/messageParts";

interface ChatMessagesProps {
  messages: UIMessage[];
  isLoading: boolean;
  onEditMessage?: (messageId: string, content: string) => Promise<void>;
  onDeleteMessage?: (messageId: string) => Promise<void>;
  onCopyMessage?: (content: string) => void;
  onForkMessage?: (messageId: string) => Promise<void>;
  onRegenerateMessage?: (messageId: string) => void;
  onOpenArtifact?: (id: string) => void;
  onClarificationAnswer?: (toolCallId: string, answer: string) => void;
  /** Set in Plan mode: offers "Approve plan" under the latest reply when it has no plan card. */
  onApprovePlan?: () => void;
  /** The model can't use tools, so the plan is written out and the button says so. */
  toolsAvailable?: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Shown with the indicator before the assistant bubble exists, e.g. "Waiting for Claude Code…". */
  statusLabel?: string;
  /** Shows the Reply pill over a selection inside one message. */
  onQuote: (text: string) => void;
  /** An overlay is open: hide the Reply pill. */
  quoteSuppressed?: boolean;
  /** Side chats: the last reply gets "Send to main", which prefills the main chat's box. */
  sendToMain?: { title: string; onSend: (text: string) => void };
}

/** Provider-run tools arrive as "dynamic-tool" parts; everything downstream keys on
 *  `tool-<name>`, so rename once here. */
function normalizeParts(parts: any[]): any[] {
  return parts.map((p) =>
    p?.type === "dynamic-tool" && typeof p.toolName === "string" ? { ...p, type: `tool-${p.toolName}` } : p,
  );
}


function ChatMessages({
  messages,
  isLoading,
  onEditMessage,
  onDeleteMessage,
  onCopyMessage,
  onForkMessage,
  onRegenerateMessage,
  onOpenArtifact,
  onClarificationAnswer,
  onApprovePlan,
  toolsAvailable = true,
  scrollRef,
  statusLabel,
  onQuote,
  quoteSuppressed,
  sendToMain,
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 scrollbar-none">
      <div className="mx-auto max-w-4xl space-y-6">
        {(() => {
          const seen = new Set<string>();
          const unique: typeof messages = [];
          for (const m of messages) {
            if (seen.has(m.id)) continue;
            seen.add(m.id);
            unique.push(m);
          }
          return unique.flatMap((message, idx) => {
            // A reply with queued messages delivered mid-way reads as reply, user bubble, reply.
            const last = idx === unique.length - 1;
            // Stale parts settle first, then the reply splits: a reply with queued messages delivered mid-way reads as reply, user bubble, reply.
            const settled = settleStaleParts(normalizeParts((message.parts || []) as any[]), last);
            const segments = splitAtQueuedMessages({ ...message, parts: settled });
            // Edit, copy, regenerate and feedback sit on the last piece of the message's own role.
            const actionsAt = segments.findLastIndex((seg) => seg.role === message.role);
            return segments.map((segment, s) => {
              const parts = segment.parts as any[];
              const content = parts
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("");
              const reasoning = parts
                .filter((p) => p.type === "reasoning")
                .map((p) => p.text || p.reasoning || "")
                .join("\n\n");
              const fileParts = parts.filter(
                (p) => p.type === "file" || p.type === "image"
              );
              const toolParts = parts.filter(
                (p) => typeof p.type === "string" && p.type.startsWith("tool-")
              );
              const sentWhileReplying = segment.role === "user" && message.role !== "user";
              return (
                <div key={segment.id} data-message-id={segment.id} data-message-index={idx}>
                  <MessageBubble
                    role={segment.role as "user" | "assistant" | "system" | "compression"}
                    content={content}
                    messageId={s === actionsAt ? message.id : undefined}
                    feedback={s === actionsAt ? (message as any).feedback ?? null : null}
                    reasoning={reasoning}
                    fileParts={fileParts}
                    toolParts={toolParts}
                    allParts={parts}
                    createdAt={(message as any).createdAt}
                    isStreaming={segment.role === "assistant" && isLoading && s === segments.length - 1}
                    onEdit={onEditMessage}
                    onDelete={onDeleteMessage}
                    onCopy={onCopyMessage}
                    onFork={s === actionsAt ? onForkMessage : undefined}
                    onRegenerateMessage={onRegenerateMessage}
                    onOpenArtifact={onOpenArtifact}
                    onClarificationAnswer={onClarificationAnswer}
                    onApprovePlan={
                      s === actionsAt && last && message.role === "assistant" && !isLoading &&
                        !settled.some((p) => p?.type === "tool-presentPlan")
                        ? onApprovePlan
                        : undefined
                    }
                    planCaption={s === actionsAt && !toolsAvailable ? "This model can't use tools, so it will write out the result." : undefined}
                  />
                  {sendToMain && s === actionsAt && message.role === "assistant" && !isLoading && (
                    <div className="mt-1 flex justify-end">
                      <SendToMainButton text={joinTextParts(parts)} parentTitle={sendToMain.title} onSendToMain={sendToMain.onSend} />
                    </div>
                  )}
                  {sentWhileReplying && (
                    <p className="mt-1 text-right text-[11px] text-zinc-400">Sent while replying</p>
                  )}
                </div>
              );
            });
          });
        })()}

        {isLoading &&
          messages.length > 0 &&
          messages[messages.length - 1]?.role === "user" && (
            <TypingIndicator isVisible={true} label={statusLabel} />
          )}
      </div>

      <div ref={messagesEndRef} />
      {/* Positions against the transcript wrapper, so it doesn't scroll with the messages. */}
      <QuoteReplyPill containerRef={scrollRef} onQuote={onQuote} suppressed={quoteSuppressed} />
    </div>
  );
}

export default memo(ChatMessages);
