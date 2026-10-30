"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import ToolInvocation from "@/app/components/ToolInvocation";
import { toolLineLabel } from "@/lib/chat/sideChatLabels";
import type { ToolPart } from "@/lib/utils/messageParts";

/** A muted line that opens to its full detail. Side chats fold reasoning and tool calls this way. */
export function SideFold({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="focus-ring flex max-w-full items-center gap-1 rounded-sm text-left text-sm text-zinc-500 transition hover:text-zinc-300"
      >
        <ChevronRight size={14} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="min-w-0 truncate">{label}</span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

interface SideToolCallProps {
  part: ToolPart;
  allParts?: ToolPart[];
  onOpenArtifact?: (id: string) => void;
  onClarificationAnswer?: (toolCallId: string, answer: string) => void;
  isStreaming?: boolean;
}

/** A tool call in a side chat: one line, unless it needs the user (an approval, a plan, a question or a sub-agent). */
export function SideToolCall(props: SideToolCallProps) {
  const { part } = props;
  const toolName = part.type.replace(/^tool-/, "");
  const detail = (
    <ToolInvocation
      part={part}
      allParts={props.allParts}
      onOpenArtifact={props.onOpenArtifact}
      onClarificationAnswer={props.onClarificationAnswer}
      isStreaming={props.isStreaming}
    />
  );
  const interactive = part.state === "approval-requested" || ["presentPlan", "runAgent", "askClarification"].includes(toolName);
  if (interactive) return detail;
  return <SideFold label={toolLineLabel(toolName, part.input)}>{detail}</SideFold>;
}
