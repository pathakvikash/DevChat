"use client";

import { useMemo, useState } from "react";
import { Play, X, Loader2 } from "lucide-react";
import { runCode, isExecutableLanguage } from "@/lib/sandbox";
import { resolveLanguage, highlightCode } from "@/lib/utils/highlight";
import AsyncButton from "./ui/AsyncButton";

interface CodeRunnerProps {
  code: string;
  language: string;
}

export default function CodeRunner({ code, language }: CodeRunnerProps) {
  const [output, setOutput] = useState<string>("");
  const [showOutput, setShowOutput] = useState(false);
  const [executing, setExecuting] = useState(false);

  const resolvedLanguage = useMemo(
    () => resolveLanguage(language),
    [language],
  );
  const highlightedCode = useMemo(
    () => highlightCode(code, resolvedLanguage),
    [code, resolvedLanguage],
  );

  const canExecute = isExecutableLanguage(language) !== null;

  async function handleRun() {
    setExecuting(true);
    setShowOutput(true);
    setOutput("Running…");
    try {
      const result = await runCode(language, code);
      setOutput(result);
    } catch (error: any) {
      setOutput(`Error: ${error?.message || String(error)}`);
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="my-2 overflow-hidden">
      <pre className="overflow-x-auto rounded-t-[var(--glass-radius-md)] glass-card">
        <code
          className={
            resolvedLanguage ? `language-${resolvedLanguage}` : undefined
          }
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </pre>

      {canExecute && (
        <div className="glass-surface border-t-0 rounded-b-[var(--glass-radius-md)] px-3 py-2 flex items-center gap-2">
          <AsyncButton
            onClick={handleRun}
            loading={executing}
            loadingText="Running…"
            icon={<Play size={14} />}
            loaderSize={14}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded glass-button text-zinc-300 hover:text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
            title="Run code"
          >
            Run
          </AsyncButton>
        </div>
      )}

      {showOutput && (
        <div className="glass-surface border-t border-[var(--glass-border)] rounded-b-[var(--glass-radius-md)] px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-zinc-400 font-medium">Output</div>
            <button
              onClick={() => setShowOutput(false)}
              className="p-0.5 rounded text-zinc-500 hover:text-zinc-300 transition"
              title="Close output"
            >
              <X size={14} />
            </button>
          </div>
          <pre className="text-sm text-zinc-300 overflow-x-auto whitespace-pre-wrap break-all max-h-96 overflow-y-auto">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}
