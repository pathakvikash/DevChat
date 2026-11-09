"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import CodeBlock from "./CodeBlock";
import { useTheme } from "./ThemeProvider";
import { useToast } from "./Toast";
import { cachedSvg, diagramLabel, errorSummary, renderMermaid } from "@/lib/mermaidRender";

type State = { svg: string } | { error: string } | null;

const RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent-strong)] rounded";

/** A finished ```mermaid fence: the diagram in a glass card, or the code plus one error line. */
export default function MermaidBlock({ code }: { code: string }) {
  const { theme } = useTheme();
  const { toast } = useToast();
  const opts = { theme, securityLevel: "strict" } as const;
  // A remount (the list re-renders) starts from the cached drawing: no flash of code.
  const [state, setState] = useState<State>(() => {
    const svg = cachedSvg(code, opts);
    return svg ? { svg } : null;
  });
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    renderMermaid(code, { theme, securityLevel: "strict" }, () => cancelled).then(
      (svg) => !cancelled && setState({ svg }),
      (e) => !cancelled && setState({ error: errorSummary(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  if (state && "error" in state) {
    return (
      <>
        <CodeBlock language="mermaid" code={code} />
        <p className="mb-2 font-sans text-sm whitespace-normal text-zinc-400">Couldn&apos;t draw this diagram. {state.error}</p>
      </>
    );
  }
  if (!state) return <CodeBlock language="mermaid" code={code} />; // until it is drawn: no blank box

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Couldn't copy", "error");
    }
  }

  return (
    <div className="glass-card rounded-[var(--glass-radius-md)] my-2 overflow-hidden">
      <div className="flex select-none items-center justify-between glass-surface px-4 py-2 text-xs text-zinc-400">
        <span>mermaid</span>
        <div className="flex gap-3">
          <button type="button" onClick={() => setShowCode((v) => !v)} className={`hover:text-zinc-200 transition ${RING}`}>
            {showCode ? "Show diagram" : "Show code"}
          </button>
          <button
            type="button"
            onClick={copy}
            title="Copy diagram source"
            aria-label={copied ? "Copied" : "Copy diagram source"}
            className={`flex items-center gap-1 hover:text-zinc-200 transition ${RING}`}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
      {showCode ? (
        <pre className="overflow-x-auto px-4 py-3 text-sm font-mono text-zinc-200">{code}</pre>
      ) : (
        <div
          role="img"
          aria-label={diagramLabel(code)}
          className="overflow-x-auto p-4 [&>svg]:mx-auto [&>svg]:h-auto [&>svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      )}
    </div>
  );
}
