"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock, Table2 } from "lucide-react";
import AppShell, { SidebarToggleButton } from "@/app/components/AppShell";
import { kindsText } from "@/lib/workflows/privacy";
import { getRelativeTime } from "@/app/components/MessageActions";

interface Row {
  id: string;
  name: string;
  rowCount: number;
  private: boolean;
  privateKinds: string[];
  updatedAt: string;
}

export default function TablesPage() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let stop = false;
    fetch("/api/tables")
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => !stop && setRows(list))
      .catch(() => !stop && setRows([]));
    return () => {
      stop = true;
    };
  }, []);

  return (
    <AppShell>
      <main className="min-h-full p-4 text-[var(--foreground)] sm:p-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-2 flex items-center gap-3">
            <SidebarToggleButton />
            <Table2 size={28} className="shrink-0 text-emerald-400" aria-hidden="true" />
            <h1 className="text-xl font-bold sm:text-2xl md:text-3xl">Tables</h1>
          </div>
          <p className="mb-6 text-sm text-zinc-400">Rows your workflows save, with a status you can change. Export them as CSV.</p>

          {rows === null ? (
            <p className="text-sm text-zinc-400">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="glass-card rounded-[var(--glass-radius-xl)] border-dashed p-12 text-center">
              <Table2 size={32} className="mx-auto mb-3 text-zinc-500" aria-hidden="true" />
              <p className="text-sm text-zinc-400">No tables yet. A workflow&apos;s Save to table card creates one.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => (
                <li key={r.id} className="glass-card flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--glass-radius-lg)] p-4">
                  <div className="min-w-0 flex-1 basis-48">
                    <Link href={`/tables/${r.id}`} className="focus-ring block truncate rounded-sm text-sm font-medium text-zinc-200 hover:underline">
                      {r.name}
                    </Link>
                    {r.private && (
                      <p className="mt-1 flex items-start gap-1.5 text-xs text-zinc-300">
                        <span className="glass inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium">
                          <Lock size={11} aria-hidden="true" /> Private
                        </span>
                        <span>{`Filled from ${kindsText(r.privateKinds)}. Workflows can't send what is in it to the web.`}</span>
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-zinc-400">
                    {r.rowCount.toLocaleString("en-US")} {r.rowCount === 1 ? "row" : "rows"}
                  </span>
                  <span className="text-xs text-zinc-400">{getRelativeTime(r.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </AppShell>
  );
}
