"use client";

import { createContext, useContext } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import CodeBlock from "./CodeBlock";
import MermaidBlock from "./MermaidBlock";
import { linkTarget, tooDeeplyNested } from "@/lib/markdownGuard";
import { openFenceBody, sameFence } from "@/lib/mermaidRender";

interface MarkdownMessageProps {
  content: string;
  /** The reply is still arriving: a fence left open is shown as code, not drawn. */
  streaming?: boolean;
  /** A workflow posted it: every link shows where it goes. */
  fromWorkflow?: boolean;
}

// The body of the still-open fence while streaming (the components map below is module scope, so it reads this).
// ponytail: matched by text, so an earlier closed fence with identical text also shows as code until the message ends.
const OpenFence = createContext<string | null>(null);

function Code({ language, code }: { language: string; code: string }) {
  const open = useContext(OpenFence);
  if (language === "mermaid" && !sameFence(code, open)) return <MermaidBlock code={code} />;
  return <CodeBlock language={language} code={code} />;
}

// Module scope: a new object per render gives every element a new component type, which remounts it and
// collapses a selection inside it.
const components: Components = {
  code(props) {
    const { children, className } = props;
    const language = className?.replace(/language-/, "") || "";
    const code = String(children).replace(/\n$/, "");

    if (className) {
      return <Code language={language} code={code} />;
    }

    return (
      <code className="glass rounded px-1.5 py-0.5 text-sm">
        {children}
      </code>
    );
  },
  h1: ({ children }) => (
    <h1 className="text-2xl font-bold mt-4 mb-2">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xl font-bold mt-3 mb-2">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-bold mt-2 mb-1">{children}</h3>
  ),
  p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => (
    <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>
  ),
  li: ({ children }) => <li className="ml-2">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-zinc-600 pl-4 my-2 italic text-zinc-400">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => {
    if (href?.startsWith("javascript:") || href?.startsWith("data:") || href?.startsWith("vbscript:")) {
      return <span className="text-zinc-500">{children}</span>;
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-500 hover:underline break-all"
      >
        {children}
      </a>
    );
  },
  table: ({ children }) => (
    <table className="border-collapse border border-zinc-700 my-2 text-sm">
      {children}
    </table>
  ),
  th: ({ children }) => (
    <th className="border border-[var(--glass-border)] px-3 py-1 glass">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-[var(--glass-border)] px-3 py-1">{children}</td>
  ),
  hr: () => <hr className="my-4 border-[var(--glass-border)]" />,
};

// For a workflow's message: a link's text can't hide an address that carries data, so the host follows the text.
const workflowComponents: Components = {
  ...components,
  a: ({ href, children }) => {
    if (!href || /^(javascript|data|vbscript):/i.test(href)) return <span className="text-zinc-500">{children}</span>;
    return (
      <>
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline break-all">
          {children}
        </a>
        <span className="ml-1 break-all text-xs text-zinc-400">({linkTarget(href)})</span>
      </>
    );
  },
};

export default function MarkdownMessage({ content, streaming = false, fromWorkflow = false }: MarkdownMessageProps) {
  // Absurdly nested quotes or lists would crash the parser: show them as they are.
  if (tooDeeplyNested(content)) return <div className="whitespace-pre-wrap break-words">{content}</div>;
  return (
    <div className="prose prose-invert max-w-none min-w-0 overflow-hidden">
      <OpenFence.Provider value={streaming ? openFenceBody(content) : null}>
        <ReactMarkdown components={fromWorkflow ? workflowComponents : components}>{content}</ReactMarkdown>
      </OpenFence.Provider>
    </div>
  );
}
