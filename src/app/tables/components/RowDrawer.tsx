"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import MarkdownMessage from "@/app/components/MarkdownMessage";
import SidePanel from "@/app/components/ui/SidePanel";
import type { Column } from "@/lib/workflows/tables";

export interface TableRow {
  id: string;
  key: string | null;
  status: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** What a cell holds as text: strings as they are, lists and objects as JSON. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** Only http and https links are clickable; anything else shows as plain text. */
export const isHttpUrl = (s: string) => /^https?:\/\//i.test(s);

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          return; // clipboard blocked: nothing to confirm
        }
        setDone(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), 1500);
      }}
      className="focus-ring glass-button inline-flex h-8 items-center gap-1 rounded-[var(--glass-radius-sm)] px-2 text-xs"
    >
      {done ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** One row, every field: Markdown for long text, a link for a URL, a Copy button on each. */
export default function RowDrawer({ row, columns, title, onClose }: { row: TableRow | null; columns: Column[]; title: string; onClose: () => void }) {
  return (
    <SidePanel isOpen={!!row} onClose={onClose} title={title || "Row"} subtitle={row ? `Status: ${row.status}` : undefined}>
      {row &&
        columns.map((c) => {
          const text = cellText(row.data[c.key]);
          return (
            <section key={c.key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium text-zinc-300">{c.label || c.key}</h3>
                {text && <CopyButton text={text} label={c.label || c.key} />}
              </div>
              {!text ? (
                <p className="text-sm text-zinc-400">Empty</p>
              ) : c.type === "longtext" ? (
                <MarkdownMessage content={text} />
              ) : c.type === "url" && isHttpUrl(text) ? (
                <a href={text} target="_blank" rel="noopener noreferrer" className="focus-ring break-all text-sm text-blue-400 underline">
                  {text}
                </a>
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm text-zinc-200">{text}</p>
              )}
            </section>
          );
        })}
    </SidePanel>
  );
}
