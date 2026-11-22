"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, AtSign, ChevronDown, ChevronRight, File as FileIcon, Folder } from "lucide-react";
import { useResource } from "@/app/hooks/useResource";
import { highlightCode, resolveLanguage } from "@/lib/utils/highlight";

interface FileRow {
  path: string;
  size: number;
}
interface Listing {
  files: FileRow[];
  truncated: boolean;
}

interface Node {
  name: string;
  path: string;
  dirs: Map<string, Node>;
  files: FileRow[];
}

function treeOf(files: FileRow[]): Node {
  const root: Node = { name: "", path: "", dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const path = node.path ? `${node.path}/${part}` : part;
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, path, dirs: new Map(), files: [] });
      node = node.dirs.get(part)!;
    }
    node.files.push(f);
  }
  return root;
}

const FILTER_CAP = 200;

/** A read-only look at the chat's working folder: a filterable tree and a highlighted preview. Paths stay in memory, never in the URL. */
export default function FilesView({ conversationId, onMention }: { conversationId: string; onMention: (path: string) => void }) {
  const listing = useResource<Listing>(async () => {
    const res = await fetch(`/api/conversations/${conversationId}/files`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    return res.json();
  }, [conversationId]);
  const [filter, setFilter] = useState("");
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ path: string; text?: string; error?: string } | null>(null);

  const files = listing.data?.files;
  const tree = useMemo(() => treeOf(files ?? []), [files]);
  const q = filter.trim().toLowerCase();
  const matches = useMemo(() => (q ? (files ?? []).filter((f) => f.path.toLowerCase().includes(q)) : []), [files, q]);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    fetch(`/api/conversations/${conversationId}/files?path=${encodeURIComponent(selected)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        return res.ok ? { path: selected, text: String(body.content ?? "") } : { path: selected, error: String(body.error ?? "Can't open this file") };
      })
      .catch(() => ({ path: selected, error: "Can't open this file" }))
      .then((p) => live && setPreview(p));
    return () => {
      live = false;
    };
  }, [conversationId, selected]);

  if (selected) {
    const ready = preview?.path === selected ? preview : null;
    const lang = resolveLanguage(selected.split(".").pop() ?? "");
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] px-3 py-2">
          <button type="button" onClick={() => setSelected(null)} aria-label="Back to files" className="focus-ring flex size-7 items-center justify-center rounded glass-button">
            <ArrowLeft size={14} aria-hidden />
          </button>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--foreground)]" title={selected}>{selected}</span>
          <button type="button" onClick={() => onMention(selected)} className="focus-ring inline-flex h-7 items-center gap-1 rounded px-2 text-xs glass-button text-[var(--foreground)]">
            <AtSign size={12} aria-hidden />
            Mention in chat
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          {!ready && <p className="text-sm text-[var(--foreground)]/60">Loading…</p>}
          {ready?.error && <p className="text-sm text-[var(--foreground)]/70">{ready.error}</p>}
          {ready?.text !== undefined &&
            (lang ? (
              <pre className="text-xs"><code className="hljs" dangerouslySetInnerHTML={{ __html: highlightCode(ready.text, lang) }} /></pre>
            ) : (
              <pre className="whitespace-pre-wrap break-words text-xs text-[var(--foreground)]">{ready.text}</pre>
            ))}
        </div>
      </div>
    );
  }

  const row = (f: FileRow, label: string, depth: number) => (
    <li key={f.path}>
      <button
        type="button"
        onClick={() => setSelected(f.path)}
        title={f.path}
        style={{ paddingLeft: 8 + depth * 14 }}
        className="focus-ring flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-xs text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)]"
      >
        <FileIcon size={12} className="shrink-0 text-[var(--foreground)]/50" aria-hidden />
        <span className="truncate">{label}</span>
      </button>
    </li>
  );

  const renderNode = (node: Node, depth: number): React.ReactNode => (
    <>
      {[...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).map((d) => {
        const open = openDirs.has(d.path);
        return (
          <li key={d.path}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenDirs((s) => { const n = new Set(s); if (open) n.delete(d.path); else n.add(d.path); return n; })}
              style={{ paddingLeft: 4 + depth * 14 }}
              className="focus-ring flex w-full items-center gap-1 rounded py-1 pr-2 text-left text-xs text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)]"
            >
              {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
              <Folder size={12} className="shrink-0 text-[var(--foreground)]/50" aria-hidden />
              <span className="truncate">{d.name}</span>
            </button>
            {open && <ul>{renderNode(d, depth + 1)}</ul>}
          </li>
        );
      })}
      {[...node.files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => row(f, f.path.split("/").pop() ?? f.path, depth))}
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[var(--glass-border)] px-3 py-2">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files"
          aria-label="Filter files"
          className="focus-ring h-8 w-full rounded-[var(--glass-radius-md)] glass-button px-2 text-xs text-[var(--foreground)] outline-none"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {listing.loading && !listing.data && <p className="px-1 text-sm text-[var(--foreground)]/60">Loading…</p>}
        {listing.error && <p className="px-1 text-sm text-red-500">{listing.error.message}</p>}
        {files && files.length === 0 && <p className="px-1 text-sm text-[var(--foreground)]/60">This folder has no files to show.</p>}
        <ul aria-label="Files">
          {q ? matches.slice(0, FILTER_CAP).map((f) => row(f, f.path, 0)) : renderNode(tree, 0)}
        </ul>
        {q && matches.length === 0 && <p className="px-1 text-sm text-[var(--foreground)]/60">No file matches.</p>}
        {q && matches.length > FILTER_CAP && <p className="px-1 pt-1 text-xs text-[var(--foreground)]/60">Showing the first {FILTER_CAP} of {matches.length}. Type more to narrow it.</p>}
        {listing.data?.truncated && <p className="px-1 pt-1 text-xs text-[var(--foreground)]/60">The list is cut off: this folder has more files.</p>}
      </div>
    </div>
  );
}
