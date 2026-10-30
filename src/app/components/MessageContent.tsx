"use client";

import MarkdownMessage from "./MarkdownMessage";
import ToolInvocation from "./ToolInvocation";
import { SideToolCall } from "./sidechat/SideFold";
import {
  groupToolParts,
  type AnyPart,
  type ToolPart,
} from "@/lib/utils/messageParts";
import { useJsonRenderMessage, Renderer } from "@json-render/react";
import { registry } from "@/lib/generativeUi/registry";
import { splitQuoteBlocks } from "@/lib/utils/quoteReply";
import { cutNotesIn } from "@/lib/utils/fileMentions";
import { AlertTriangle } from "lucide-react";

interface MessageContentProps {
  role: "user" | "assistant" | "system";
  allParts: AnyPart[];
  toolParts: ToolPart[];
  isUser: boolean;
  isStreaming: boolean;
  onOpenArtifact?: (id: string) => void;
  onClarificationAnswer?: (toolCallId: string, answer: string) => void;
  /** Side chat: tool calls fold to one line, and prose has no width cap. */
  compact?: boolean;
}

export default function MessageContent({
  role,
  allParts,
  toolParts,
  isUser,
  isStreaming,
  onOpenArtifact,
  onClarificationAnswer,
  compact = false,
}: MessageContentProps) {
  const isAssistant = role === "assistant";
  const merged = groupToolParts(allParts);
  // Generative UI: data-spec parts (already split from prose server-side by
  // pipeJsonRender) aren't a recognized part type in groupToolParts/the loop
  // below, so they just fall through and render nothing — this hook is only
  // for reconstructing the spec for the Renderer, not for text extraction.
  const { spec, hasSpec } = useJsonRenderMessage(allParts as any);

  return (
    <>
      {merged.map((item) => {
        if (item.type === "tool-group" && compact) {
          return (
            <SideToolCall
              key={item.key}
              part={item.parts[0]}
              allParts={item.parts}
              onOpenArtifact={onOpenArtifact}
              onClarificationAnswer={onClarificationAnswer}
              isStreaming={isStreaming}
            />
          );
        }
        if (item.type === "tool-group") {
          return (
            <ToolInvocation
              key={item.key}
              part={item.parts[0]}
              allParts={item.parts}
              onOpenArtifact={onOpenArtifact}
              onClarificationAnswer={onClarificationAnswer}
              isStreaming={isStreaming}
            />
          );
        }
        const p = item.part;
        if (p.type === "text") {
          return (
            <div key={item.key} className={isAssistant && !compact ? "max-w-2xl" : ""}>
              {isUser ? (
                <>
                {/* `>` runs (quote-reply) get a quote style; the rest stays plain text. */}
                {splitQuoteBlocks((p as any).text ?? "").map((seg, i) =>
                  seg.type === "quote" ? (
                    <blockquote
                      key={i}
                      className="my-1.5 border-l-2 border-white/40 pl-3 italic text-white/80 whitespace-pre-wrap wrap-break-word break-all"
                    >
                      {seg.text}
                    </blockquote>
                  ) : (
                    <div key={i} className="whitespace-pre-wrap wrap-break-word break-all">
                      {seg.text}
                    </div>
                  ),
                )}
                {cutNotesIn((p as { text?: string }).text ?? "").map((note) => (
                  <p key={`cut-${note.path}`} className="mt-1 flex items-center gap-1 text-xs text-zinc-400">
                    <AlertTriangle size={12} aria-hidden className="shrink-0 text-amber-400" />
                    Trimmed: {note.path} ({note.detail} sent)
                  </p>
                ))}
                </>
              ) : (
                <MarkdownMessage content={(p as any).text} />
              )}
            </div>
          );
        }
        return null;
      })}
      {isAssistant && hasSpec && spec && (
        <div className="max-w-2xl">
          <Renderer spec={spec} registry={registry} loading={isStreaming} />
        </div>
      )}
      {isStreaming && !toolParts?.length && (
        <span className="ml-1 animate-pulse">▊</span>
      )}
    </>
  );
}
