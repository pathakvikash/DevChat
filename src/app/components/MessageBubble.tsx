"use client";

import { memo, useState, useCallback } from "react";
import FileAttachments from "./FileAttachments";
import ThinkingBlock from "./ThinkingBlock";
import MessageContent from "./MessageContent";
import MessageActions from "./MessageActions";
import MessageEditor from "./MessageEditor";
import MarkdownMessage from "./MarkdownMessage";
import ToolInvocation from "./ToolInvocation";
import CompressionEvent from "./CompressionEvent";
import { splitThinking } from "@/lib/utils/splitThinking";
import {
  findCompressionEvent,
  type FilePart,
  type ToolPart,
  type AnyPart,
} from "@/lib/utils/messageParts";

interface MessageBubbleProps {
  role: "user" | "assistant" | "system" | "compression";
  content: string;
  messageId?: string;
  fileParts?: FilePart[];
  toolParts?: ToolPart[];
  allParts?: AnyPart[];
  reasoning?: string;
  isStreaming?: boolean;
  createdAt?: Date | string;
  onEdit?: (messageId: string, content: string) => Promise<void>;
  onDelete?: (messageId: string) => Promise<void>;
  onCopy?: (content: string) => void;
  onRegenerateMessage?: (messageId: string) => void;
  onOpenArtifact?: (id: string) => void;
  onClarificationAnswer?: (toolCallId: string, answer: string) => void;
  feedback?: { id: string; rating: number } | null;
}

function MessageBubble({
  role,
  content,
  messageId,
  fileParts = [],
  toolParts = [],
  allParts = [],
  reasoning = "",
  isStreaming = false,
  createdAt,
  onEdit,
  onDelete,
  onCopy,
  onRegenerateMessage,
  onOpenArtifact,
  onClarificationAnswer,
  feedback,
}: MessageBubbleProps) {
  const { thinking: inlineThinking, content: cleanContent } =
    splitThinking(content);
  const combinedThinking = [reasoning, inlineThinking]
    .filter(Boolean)
    .join("\n\n");
  const isUser = role === "user";

  const [isEditing, setIsEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState(content);

  if (role === "compression") {
    const compressionPart = findCompressionEvent(allParts || []);
    if (compressionPart) {
      return (
        <CompressionEvent
          summary={compressionPart.summary}
          compressedAt={compressionPart.compressedAt}
          beforeTokens={compressionPart.beforeTokens}
          afterTokens={compressionPart.afterTokens}
          reductionPercent={compressionPart.reductionPercent}
          beforeMessages={compressionPart.beforeMessages}
        />
      );
    }
    return null;
  }

  const startEditing = useCallback(() => {
    setEditBuffer(content);
    setIsEditing(true);
  }, [content]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditBuffer(content);
  }, [content]);

  const handleEdit = useCallback(
    async (newContent: string) => {
      if (!messageId || !onEdit) return;
      if (newContent === content) {
        setIsEditing(false);
        return;
      }
      await onEdit(messageId, newContent);
      setIsEditing(false);
    },
    [messageId, onEdit, content],
  );

  const showEditor = isEditing && isUser;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`
          relative group flex flex-col max-w-[85%] min-w-0
          ${isUser ? "items-end" : "items-start"}
        `}
      >
        <div
          className={`
            w-fit max-w-full rounded-[var(--glass-radius-xl)] px-4 py-3 relative
            ${isUser
              ? "glass-button-primary text-white"
              : "glass-card text-[var(--foreground)]"
            }
            ${showEditor ? "shadow-[var(--glass-shadow-glow)]" : ""}
          `}
        >
          <FileAttachments fileParts={fileParts} />

          {!isUser && combinedThinking && (
            <ThinkingBlock text={combinedThinking} />
          )}

          {showEditor ? (
            <MessageEditor
              initialContent={editBuffer}
              onSave={handleEdit}
              onCancel={cancelEditing}
              embedded
            />
          ) : allParts && allParts.length > 0 ? (
            <MessageContent
              role={role}
              allParts={allParts}
              toolParts={toolParts}
              isUser={isUser}
              isStreaming={isStreaming}
              onOpenArtifact={onOpenArtifact}
              onClarificationAnswer={onClarificationAnswer}
            />
          ) : (
            <>
              {(isUser ? content : cleanContent) && (
                <div className={isUser ? "" : "max-w-2xl"}>
                  {isUser ? (
                    <div className="whitespace-pre-wrap break-words">
                      {content}
                    </div>
                  ) : (
                    <>
                      <MarkdownMessage content={cleanContent} />
                      {isStreaming && !toolParts.length && (
                        <span className="ml-1 animate-pulse">▊</span>
                      )}
                    </>
                  )}
                </div>
              )}

              {toolParts.length > 0 && (
                <div
                  className={(isUser ? content : cleanContent) ? "mt-2" : ""}
                >
                  {toolParts.map((p, i) => (
                    <ToolInvocation
                      key={`${p.toolCallId || i}-${p.state || p.type}-${i}`}
                      part={p}
                      allParts={toolParts}
                      onOpenArtifact={onOpenArtifact}
                      onClarificationAnswer={onClarificationAnswer}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {!content &&
            !combinedThinking &&
            fileParts.length === 0 &&
            toolParts.length === 0 &&
            !showEditor && (
              <div className="text-zinc-400 italic">
                {isUser ? "(empty message)" : "..."}
              </div>
            )}
        </div>

        <MessageActions
          messageId={messageId}
          isUser={isUser}
          isStreaming={isStreaming}
          content={content}
          createdAt={createdAt}
          initialFeedback={feedback?.rating ?? null}
          onEdit={onEdit}
          onDelete={onDelete}
          onCopy={onCopy}
          onStartEditing={startEditing}
          onRegenerateMessage={onRegenerateMessage}
        />
      </div>
    </div>
  );
}

const MessageBubbleMemo = memo(MessageBubble, (prev, next) => {
  if (prev.messageId !== next.messageId) return false;
  if (prev.role !== next.role) return false;
  if (prev.content !== next.content) return false;
  if (prev.reasoning !== next.reasoning) return false;
  if (prev.isStreaming !== next.isStreaming) return false;
  if (prev.createdAt !== next.createdAt) return false;
  if ((prev.feedback?.rating ?? null) !== (next.feedback?.rating ?? null)) return false;
  const prevParts = prev.allParts ?? [];
  const nextParts = next.allParts ?? [];
  if (prevParts.length !== nextParts.length) return false;
  for (let i = 0; i < prevParts.length; i++) {
    const a = prevParts[i] as any;
    const b = nextParts[i] as any;
    if (a.type !== b.type) return false;
    if (a.type === "text" && a.text !== b.text) return false;
    if (a.type === "reasoning" && (a.text ?? a.reasoning) !== (b.text ?? b.reasoning)) return false;
    if (a.type === "file" && (a.url !== b.url || a.name !== b.name)) return false;
    if (typeof a.type === "string" && a.type.startsWith("tool-") && a.toolCallId !== b.toolCallId) return false;
  }
  return (
    prev.onEdit === next.onEdit &&
    prev.onDelete === next.onDelete &&
    prev.onCopy === next.onCopy &&
    prev.onRegenerateMessage === next.onRegenerateMessage &&
    prev.onOpenArtifact === next.onOpenArtifact &&
    prev.onClarificationAnswer === next.onClarificationAnswer
  );
});

export default MessageBubbleMemo;
