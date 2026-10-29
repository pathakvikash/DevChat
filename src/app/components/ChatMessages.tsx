"use client";

import { memo, useEffect, useRef } from "react";
import { UIMessage } from "ai";
import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";
import QuoteReplyPill from "./QuoteReplyPill";
import { settleStaleParts } from "@/lib/utils/messageParts";

interface ChatMessagesProps {
  messages: UIMessage[];
  isLoading: boolean;
  onEditMessage?: (messageId: string, content: string) => Promise<void>;
  onDeleteMessage?: (messageId: string) => Promise<void>;
  onCopyMessage?: (content: string) => void;
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
  onRegenerateMessage,
  onOpenArtifact,
  onClarificationAnswer,
  onApprovePlan,
  toolsAvailable = true,
  scrollRef,
  statusLabel,
  onQuote,
  quoteSuppressed,
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
          return unique.map((message, idx) => {
            const parts = settleStaleParts(normalizeParts((message.parts || []) as any[]), idx === unique.length - 1);
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
            return (
              <div key={message.id} data-message-id={message.id} data-message-index={idx}>
                <MessageBubble key={message.id}
                  role={message.role as "user" | "assistant" | "system" | "compression"}
                  content={content}
                  messageId={message.id}
                  feedback={(message as any).feedback ?? null}
                  reasoning={reasoning}
                  fileParts={fileParts}
                  toolParts={toolParts}
                  allParts={parts}
                  createdAt={(message as any).createdAt}
                  isStreaming={message.role === "assistant" && isLoading}
                  onEdit={onEditMessage}
                  onDelete={onDeleteMessage}
                  onCopy={onCopyMessage}
                  onRegenerateMessage={onRegenerateMessage}
                  onOpenArtifact={onOpenArtifact}
                  onClarificationAnswer={onClarificationAnswer}
                  onApprovePlan={
                    onApprovePlan && idx === unique.length - 1 && message.role === "assistant" && !isLoading &&
                      !parts.some((p) => p?.type === "tool-presentPlan")
                      ? onApprovePlan
                      : undefined
                  }
                  planCaption={toolsAvailable ? undefined : "This model can't use tools, so it will write out the result."}
                />
              </div>
            );
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
