"use client";

import ReactMarkdown from "react-markdown";
import CodeBlock from "./CodeBlock";

interface MarkdownMessageProps {
  content: string;
}

export default function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="prose prose-invert max-w-none min-w-0 overflow-hidden">
      <ReactMarkdown
        components={{
          code(props) {
            const { children, className } = props;
            const language = className?.replace(/language-/, "") || "";
            const code = String(children).replace(/\n$/, "");

            if (className) {
              return <CodeBlock language={language} code={code} />;
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
