"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Boxes, Code2, FileText, Globe, Image as ImageIcon, Search, Table2, Workflow, type LucideIcon } from "lucide-react";
import AppShell, { SidebarToggleButton } from "@/app/components/AppShell";

interface ArtifactRow {
  id: string;
  title: string;
  type: string;
  conversationId: string;
  conversationTitle: string;
  updatedAt: string;
}

const ICONS: Record<string, LucideIcon> = {
  code: Code2, document: FileText, report: FileText, table: Table2, data: Table2,
  svg: ImageIcon, mermaid: Workflow, html: Globe,
};

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  for (const [n, unit] of [[86400, "d"], [3600, "h"], [60, "m"]] as const) {
    if (s >= n) return `${Math.floor(s / n)}${unit} ago`;
  }
  return "just now";
}

export default function ArtifactsPage() {
  const [items, setItems] = useState<ArtifactRow[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/artifacts?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        if (res.ok) setItems((await res.json()).artifacts);
      } catch {}
    }, q ? 200 : 0);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  return (
    <AppShell>
      <main className="text-[var(--foreground)] p-4 sm:p-8 min-h-full">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <SidebarToggleButton />
            <Boxes size={28} className="text-purple-400 shrink-0" />
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold">Artifacts</h1>
          </div>
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search artifacts"
              aria-label="Search artifacts"
              className="w-full glass-input rounded-[var(--glass-radius-md)] pl-9 pr-3 py-2 text-sm"
            />
          </div>
          {items === null ? null : items.length === 0 ? (
            <p className="text-zinc-500 text-sm py-12 text-center">
              {q ? "No artifacts match your search." : "No artifacts yet. Ask the model to build something and it will show up here."}
            </p>
          ) : (
            <ul className="grid gap-2">
              {items.map((a) => {
                const Icon = ICONS[a.type] ?? FileText;
                return (
                  <li key={a.id} className="glass-card rounded-[var(--glass-radius-lg)] p-3 flex items-center gap-3 min-w-0">
                    <Icon size={20} className="text-zinc-500 shrink-0" aria-hidden />
                    <Link href={`/artifact-preview/${a.conversationId}/${a.id}`} className="min-w-0 flex-1">
                      <div className="font-medium truncate">{a.title}</div>
                      <div className="text-xs text-zinc-500 truncate">{a.conversationTitle} · {ago(a.updatedAt)}</div>
                    </Link>
                    <Link href={`/c/${a.conversationId}`} className="text-xs text-zinc-500 hover:text-zinc-300 shrink-0 underline">
                      Open chat
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </AppShell>
  );
}
