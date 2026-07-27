"use client";

import { useState, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Play,
  Copy,
  Code2,
  Loader2,
  Terminal,
} from "lucide-react";
import { runCode, isExecutableLanguage } from "@/lib/sandbox";
import { resolveLanguage, highlightCode } from "@/lib/utils/highlight";

interface ArtifactCardProps {
  title: string;
  language: string;
  code: string;
  output: string;
  isStreaming?: boolean;
}

export default function ArtifactCard({
  title,
  language,
  code,
  output,
  isStreaming,
}: ArtifactCardProps) {
  const [codeExpanded, setCodeExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [localOutput, setLocalOutput] = useState(output);

  const resolvedLang = useMemo(() => resolveLanguage(language), [language]);
  const highlightedCode = useMemo(
    () => highlightCode(code, resolvedLang),
    [code, resolvedLang],
  );
  const canExecute = isExecutableLanguage(language) !== null;
  const codeLines = code.split("\n").length;

  async function copyToClipboard() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleRun() {
    setExecuting(true);
    setLocalOutput("Running…");
    try {
      const result = await runCode(language, code);
      setLocalOutput(result);
    } catch (error: any) {
      setLocalOutput(`Error: ${error?.message || String(error)}`);
    } finally {
      setExecuting(false);
    }
  }

  const displayOutput = executing
    ? "Running…"
    : localOutput
      ? localOutput
      : undefined;

  return (
    <div className="my-3 glass-card rounded-[var(--glass-radius-lg)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 glass-surface border-b border-[var(--glass-border)]">
        <div className="flex items-center gap-2 min-w-0">
          <Code2 size={16} className="text-blue-400 shrink-0" />
          <span className="text-sm font-medium text-zinc-200 truncate">
            {title}
          </span>
          {isStreaming && (
            <Loader2 size={12} className="animate-spin text-blue-400 shrink-0" />
          )}
        </div>
        <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 shrink-0">
          {language || "code"}
        </span>
      </div>

      {/* Output Section */}
      <div className="px-4 py-3 border-b border-[var(--glass-border)] bg-[var(--glass-bg)]">
        <div className="flex items-center gap-1.5 mb-2">
          <Terminal size={12} className="text-zinc-500" />
          <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500">
            Output
          </span>
        </div>
        {displayOutput !== undefined ? (
          <pre className="text-sm font-mono text-zinc-200 whitespace-pre-wrap break-all overflow-x-auto leading-relaxed">
            {displayOutput}
          </pre>
        ) : (
          <span className="text-sm text-zinc-600 italic">(no output)</span>
        )}
      </div>

      {/* Code toggle */}
      <button
        onClick={() => setCodeExpanded(!codeExpanded)}
        className="flex items-center gap-1.5 w-full px-4 py-2 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-[var(--glass-bg-hover)] transition-colors border-b border-[var(--glass-border)]"
      >
        {codeExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {codeExpanded ? "Hide code" : "Show code"}
        <span className="text-zinc-600 ml-1">({codeLines} lines)</span>
      </button>

      {/* Code Section (collapsible) */}
      {codeExpanded && (
        <div className="border-b border-[var(--glass-border)]">
          <pre className="overflow-x-auto p-4 bg-[var(--glass-bg)]">
            <code
              className={
                resolvedLang ? `language-${resolvedLang}` : undefined
              }
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
          </pre>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 px-4 py-2 glass-surface">
        {canExecute && (
          <button
            onClick={handleRun}
            disabled={executing}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-700 disabled:opacity-50 text-white transition-colors"
          >
            {executing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Play size={12} />
            )}
            {executing ? "Running…" : "Run"}
          </button>
        )}
          <button
            onClick={copyToClipboard}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded glass-button text-zinc-300"
          >
          <Copy size={12} />
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}
