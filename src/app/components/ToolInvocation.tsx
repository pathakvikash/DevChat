"use client";

import { Loader2, CheckCircle2, XCircle, Check, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { ToolPart } from "@/lib/utils/messageParts";
import ArtifactCard from "./ArtifactCard";
import ArtifactReference from "./ArtifactReference";
import ClarificationForm from "./ClarificationForm";

interface ToolInvocationProps {
  part: ToolPart;
  allParts?: ToolPart[];
  onOpenArtifact?: (id: string) => void;
  onClarificationAnswer?: (toolCallId: string, answer: string) => void;
}

export default function ToolInvocation({
  part,
  allParts,
  onOpenArtifact,
  onClarificationAnswer,
}: ToolInvocationProps) {
  const toolName = part.type.replace(/^tool-/, "");
  const isArtifact =
    toolName === "createArtifact" || toolName === "updateArtifact";
  const isExec = toolName === "executeCode";
  const isClarification = toolName === "askClarification";

  if (isClarification) {
    const input = part.input || {};
    const done = part.state === "output-available" || part.state === "result";
    const answer = done ? (part.output ?? "") : "";

    if (!done) {
      return (
        <ClarificationForm
          question={input.question || "Please clarify:"}
          type={input.type || "text"}
          options={input.options}
          recommended={input.recommended}
          onAnswer={(answer) =>
            onClarificationAnswer?.(part.toolCallId || "", answer)
          }
        />
      );
    }

    return (
      <div className="my-2 glass-card rounded-[var(--glass-radius-md)] border border-emerald-900/50 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3">
          <Check size={16} className="text-emerald-400 flex-shrink-0" />
          <div>
            <p className="text-xs text-emerald-400/70">
              {input.question || "Question"}
            </p>
            <p className="text-sm text-emerald-200 font-medium">{answer}</p>
          </div>
        </div>
      </div>
    );
  }

  if (isArtifact) {
    const input = part.input || {};
    const output = part.output || "";
    const artifactId = input.artifactId || (typeof output === "string" ? output.replace(/^Artifact (created|updated): /, "").split(" ")[0] : "");
    const title = input.title || "Artifact";
    const type = input.type || "document";
    const version = input.version || 1;
    const done = part.state === "output-available" || part.state === "result";

    return (
      <div className="my-2">
        <ArtifactReference
          artifactId={artifactId}
          title={title}
          type={type}
          version={version}
          onClick={(id) => onOpenArtifact?.(id)}
        />
        {!done && (
          <div className="flex items-center gap-2 mt-2 text-xs text-zinc-500">
            <Loader2 size={12} className="animate-spin text-blue-400" />
            <span>{toolName === "createArtifact" ? "Creating artifact..." : "Updating artifact..."}</span>
          </div>
        )}
      </div>
    );
  }
  const lang = part.input?.language || "";
  const code = part.input?.code || "";
  const done = part.state === "output-available" || part.state === "result";
  const errored = part.state === "output-error";
  const running = !done && !errored;

  const resultPart = allParts?.find(
    (p) =>
      p.toolCallId === part.toolCallId &&
      (p.output !== undefined || p.errorText !== undefined)
  );
  const hasResult = !!resultPart;
  const resultErrored = !!resultPart?.errorText;

  const [collapsed, setCollapsed] = useState(true);

  if (isExec && code) {
    const output = hasResult
      ? resultErrored
        ? resultPart.errorText || "Error"
        : typeof resultPart.output === "object"
          ? JSON.stringify(resultPart.output, null, 2)
          : String(resultPart.output ?? "")
      : !running
        ? String(part.output ?? "")
        : "";

    const title = lang ? `${lang.charAt(0).toUpperCase() + lang.slice(1)} Execution` : "Code Execution";

    return (
      <ArtifactCard
        title={title}
        language={lang}
        code={code}
        output={output}
        isStreaming={running && !hasResult}
      />
    );
  }

  return (
    <div className="my-2 glass-card rounded-[var(--glass-radius-md)] overflow-hidden">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 bg-[var(--glass-bg-elevated)] text-xs text-left hover:bg-[var(--glass-bg-hover)] transition-colors"
      >
        {collapsed ? (
          <ChevronRight size={14} className="text-zinc-500 shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-zinc-500 shrink-0" />
        )}
        {running && !hasResult ? (
          <Loader2 size={14} className="animate-spin text-blue-400" />
        ) : errored || resultErrored ? (
          <XCircle size={14} className="text-red-400" />
        ) : (
          <CheckCircle2 size={14} className="text-green-400" />
        )}
        <span className="font-medium text-zinc-200">
          {isExec ? `Executed ${lang || "code"}` : `Tool: ${toolName}`}
        </span>
        {(running && !hasResult) && <span className="text-zinc-500">running…</span>}
        {hasResult && !running && <span className="text-emerald-400">done</span>}
      </button>

      {!collapsed && (
        <>
          {code && (
            <pre className="px-3 py-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all text-zinc-300 border-b border-[var(--glass-border)]">
              {code}
            </pre>
          )}

          {hasResult && (
            <div className="px-3 py-2 bg-[var(--glass-bg)]">
              <div className="text-xs text-zinc-400 mb-1">Output</div>
              <pre className="text-xs font-mono text-zinc-200 whitespace-pre-wrap break-all overflow-x-auto">
                {resultErrored ? resultPart.errorText || "Error" : typeof resultPart.output === 'object' ? JSON.stringify(resultPart.output, null, 2) : String(resultPart.output ?? "")}
              </pre>
            </div>
          )}

          {!hasResult && done && (
            <div className="px-3 py-2 bg-[var(--glass-bg)]">
              <div className="text-xs text-zinc-400 mb-1">Output</div>
              <pre className="text-xs font-mono text-zinc-200 whitespace-pre-wrap break-all overflow-x-auto">
                {errored ? part.errorText || "Error" : String(part.output ?? "")}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
