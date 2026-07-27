"use client";

import { memo, useEffect, useRef } from "react";
import { UIMessage } from "ai";
import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";

interface ChatMessagesProps {
  messages: UIMessage[];
  isLoading: boolean;
  onEditMessage?: (messageId: string, content: string) => Promise<void>;
  onDeleteMessage?: (messageId: string) => Promise<void>;
  onCopyMessage?: (content: string) => void;
  onRegenerateMessage?: (messageId: string) => void;
  onOpenArtifact?: (id: string) => void;
  onClarificationAnswer?: (toolCallId: string, answer: string) => void;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
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
  scrollRef,
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
            const parts = (message.parts || []) as any[];
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
                />
              </div>
            );
          });
        })()}

        {isLoading &&
          messages.length > 0 &&
          messages[messages.length - 1]?.role === "user" && (
            <TypingIndicator isVisible={true} />
          )}
      </div>

      <div ref={messagesEndRef} />
    </div>
  );
}

export default memo(ChatMessages);
