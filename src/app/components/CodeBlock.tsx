"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import CodeRunner from "./CodeRunner";

interface CodeBlockProps {
  language: string;
  code: string;
}

export default function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function copyToClipboard() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="glass-card rounded-[var(--glass-radius-md)] my-2 overflow-hidden group">
      <div className="flex items-center justify-between glass-surface px-4 py-2 text-xs text-zinc-400">
        <span>{language || "code"}</span>
        <div className="flex gap-2">
          <button
            onClick={copyToClipboard}
            className="flex items-center gap-1 hover:text-zinc-200 transition"
            title="Copy code"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      <CodeRunner code={code} language={language} />
    </div>
  );
}
