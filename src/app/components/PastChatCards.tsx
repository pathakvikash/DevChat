"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, History, Loader2, XCircle } from "lucide-react";
import type { ToolPart } from "@/lib/utils/messageParts";
import type { ChatHit } from "@/lib/chatSearch";
import { getRelativeTime } from "./MessageActions";

interface PastChatCardProps {
  part: ToolPart;
  /** The part carrying this call's output or error; undefined while it runs. */
  result?: ToolPart;
}

type Status = "running" | "failed" | "done";
type Hit = Omit<ChatHit, "updatedAt"> & { updatedAt: string };

const STATUS_LABEL: Record<Status, string> = { running: "Running", failed: "Failed", done: "Done" };

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent-strong)]";

function StatusIcon({ status, idle: Icon }: { status: Status; idle: typeof History }) {
  if (status === "running") return <Loader2 size={14} className="animate-spin text-blue-400 shrink-0" />;
  if (status === "failed") return <XCircle size={14} className="text-red-400 shrink-0" />;
  return <Icon size={14} className="text-zinc-500 shrink-0" />;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  // The capture group makes split() keep the matches, at the odd indexes.
  const pieces = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <>
      {pieces.map((s, i) =>
        i % 2 ? (
          <mark key={i} className="bg-[var(--glass-bg-active)] text-[var(--foreground)] rounded px-0.5">
            {s}
          </mark>
        ) : (
          s
        ),
      )}
    </>
  );
}

/** Results of `searchChats`, or of `/recall`, which puts the same part on the user's message. */
export function SearchChatsCard({ part, result }: PastChatCardProps) {
  const [open, setOpen] = useState(true);
  const query: string = part.input?.query ?? "";
  const hits: Hit[] | null = Array.isArray(result?.output?.results) ? result.output.results : null;
  const status: Status = !result ? "running" : result.errorText || !hits ? "failed" : "done";
  const Chevron = open ? ChevronDown : ChevronRight;
  const meta =
    status === "done" && hits
      ? hits.length === 0
        ? "No matches"
        : `${hits.length} ${hits.length === 1 ? "chat" : "chats"}`
      : STATUS_LABEL[status];

  return (
    <div role="group" aria-label="Past chat search" className="my-2 glass-card rounded-[var(--glass-radius-md)] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex items-center gap-2 w-full px-3 py-2 bg-[var(--glass-bg-elevated)] text-xs text-left hover:bg-[var(--glass-bg-hover)] transition-colors ${FOCUS_RING}`}
      >
        <Chevron size={14} className="text-zinc-500 shrink-0" />
        <StatusIcon status={status} idle={History} />
        <span className="font-medium text-zinc-200 truncate">Searched past chats for &quot;{query}&quot;</span>
        <span className="ml-auto text-zinc-400 tabular-nums shrink-0">{meta}</span>
      </button>
      {open && status !== "running" && (
        <div className="px-3 py-2 text-sm">
          {status === "failed" ? (
            <p className="text-zinc-400">Couldn&apos;t search past chats</p>
          ) : hits?.length === 0 ? (
            <p className="text-zinc-400">No past chats matched &quot;{query}&quot;</p>
          ) : (
            hits?.map((h) => (
              <Link
                key={h.id}
                href={`/c/${h.id}`}
                className={`block rounded-[var(--glass-radius-sm)] px-2 py-1.5 hover:bg-[var(--glass-bg-hover)] ${FOCUS_RING}`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-sm text-zinc-200 truncate">{h.title}</span>
                  <span className="ml-auto text-[11px] text-zinc-400 shrink-0">
                    {getRelativeTime(h.updatedAt)} · {h.model.split("/").pop()}
                  </span>
                </div>
                {h.snippet && (
                  <p className="text-xs text-zinc-400 line-clamp-2">
                    <Highlight text={h.snippet} query={query} />
                  </p>
                )}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** One line for `readChat`: the chat's title, linked. */
export function ReadChatCard({ part, result }: PastChatCardProps) {
  // readChat returns only the framed text, which names the chat in its first line.
  const output = result?.output;
  const parsed = typeof output === "string" ? /^Quoted from past chat "(.*?)" — /.exec(output)?.[1] : undefined;
  const title = parsed === undefined ? undefined : parsed.trim() || "Untitled chat";
  const status: Status = !result ? "running" : title ? "done" : "failed";

  return (
    <div role="group" aria-label="Past chat read" className="my-2 glass-card rounded-[var(--glass-radius-md)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--glass-bg-elevated)] text-xs">
        <StatusIcon status={status} idle={FileText} />
        <span className="font-medium text-zinc-200 truncate">
          {title ? (
            <>
              Read{" "}
              <Link
                href={`/c/${part.input?.id}`}
                className={`hover:underline rounded-[var(--glass-radius-sm)] ${FOCUS_RING}`}
              >
                &quot;{title}&quot;
              </Link>
            </>
          ) : (
            "Read past chat"
          )}
        </span>
        <span className="ml-auto text-zinc-400 shrink-0">{STATUS_LABEL[status]}</span>
      </div>
    </div>
  );
}
