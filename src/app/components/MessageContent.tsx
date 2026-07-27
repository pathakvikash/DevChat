"use client";

import MarkdownMessage from "./MarkdownMessage";
import ToolInvocation from "./ToolInvocation";
import {
  groupToolParts,
  type AnyPart,
  type ToolPart,
} from "@/lib/utils/messageParts";

interface MessageContentProps {
  role: "user" | "assistant" | "system";
  allParts: AnyPart[];
  toolParts: ToolPart[];
  isUser: boolean;
  isStreaming: boolean;
  onOpenArtifact?: (id: string) => void;
  onClarificationAnswer?: (toolCallId: string, answer: string) => void;
}

export default function MessageContent({
  role,
  allParts,
  toolParts,
  isUser,
  isStreaming,
  onOpenArtifact,
  onClarificationAnswer,
}: MessageContentProps) {
  const isAssistant = role === "assistant";
  const merged = groupToolParts(allParts);

  return (
    <>
      {merged.map((item) => {
        if (item.type === "tool-group") {
          return (
            <ToolInvocation
              key={item.key}
              part={item.parts[0]}
              allParts={item.parts}
              onOpenArtifact={onOpenArtifact}
              onClarificationAnswer={onClarificationAnswer}
            />
          );
        }
        const p = item.part;
        if (p.type === "text") {
          return (
            <div key={item.key} className={isAssistant ? "max-w-2xl" : ""}>
              {isUser ? (
                <div className="whitespace-pre-wrap wrap-break-word break-all">
                  {(p as any).text}
                </div>
              ) : (
                <MarkdownMessage content={(p as any).text} />
              )}
            </div>
          );
        }
        return null;
      })}
      {isStreaming && !toolParts?.length && (
        <span className="ml-1 animate-pulse">▊</span>
      )}
    </>
  );
}
