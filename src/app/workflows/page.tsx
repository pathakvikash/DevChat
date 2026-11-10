"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Play, Plus, Workflow } from "lucide-react";
import AppShell, { SidebarToggleButton } from "@/app/components/AppShell";
import { getRelativeTime } from "@/app/components/MessageActions";
import { useToast } from "@/app/components/Toast";
import { TEMPLATE_OPTIONS, type TemplateKind } from "@/lib/workflows/templates";
import { runStatus, StatusBadge } from "./components/RunStatus";
import type { RunState } from "@/lib/workflows/graph";

interface Row {
  id: string;
  name: string;
  cardCount: number;
  updatedAt: string;
  lastRun: { id: string; state: RunState; startedAt: string } | null;
}

export default function WorkflowsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [menu, setMenu] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  // Whether command-line models and folders can be used here; the local templates are disabled when not.
  const [hostTools, setHostTools] = useState(false);
  const [hostWhy, setHostWhy] = useState("");
  useEffect(() => {
    fetch("/api/settings/keys")
      .then((res) => (res.ok ? res.json() : null))
      .then((k) => {
        if (!k) return;
        setHostTools(k.hostTools === true);
        setHostWhy(typeof k.hostToolsReason === "string" ? k.hostToolsReason : "");
      })
      .catch(() => {});
  }, []);

  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let stop = false;
    fetch("/api/workflows")
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => !stop && setRows(list))
      .catch(() => !stop && setRows([]));
    return () => {
      stop = true;
    };
  }, [tick]);

  // A run in progress changes its row, so keep the list fresh while one runs.
  const anyRunning = rows?.some((r) => r.lastRun?.state === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [anyRunning, load]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  async function create(template: TemplateKind) {
    setMenu(false);
    const res = await fetch("/api/workflows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template }) });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return toast(res.status === 403 && body.error ? body.error : "Couldn't create the workflow. Try again.", "error");
    }
    router.push(`/workflows/${(await res.json()).id}`);
  }

  async function run(row: Row) {
    const res = await fetch(`/api/workflows/${row.id}/runs`, { method: "POST" });
    if (res.status === 202) {
      toast("Run started", "success");
      load();
      return;
    }
    const body = await res.json().catch(() => ({}));
    toast(`Couldn't start the run. ${body.error ?? "Try again."}`, "error", { label: "Open", href: `/workflows/${row.id}` });
  }

  return (
    <AppShell>
      <main className="min-h-full p-4 text-[var(--foreground)] sm:p-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarToggleButton />
              <Workflow size={28} className="shrink-0 text-blue-400" aria-hidden="true" />
              <h1 className="text-xl font-bold sm:text-2xl md:text-3xl">Workflows</h1>
            </div>
            <div ref={wrap} className="relative shrink-0">
              <button type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} className="focus-ring glass-button-primary inline-flex h-9 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-3 text-sm font-medium text-white">
                <Plus size={14} aria-hidden="true" /> New workflow <ChevronDown size={14} aria-hidden="true" />
              </button>
              {menu && (
                <ul role="menu" className="glass-panel-strong absolute right-0 top-full z-50 mt-1 w-72 rounded-[var(--glass-radius-md)] p-1 shadow-lg">
                  {TEMPLATE_OPTIONS.map((t) => {
                    const off = !!t.local && !hostTools;
                    return (
                      <li key={t.kind} role="none">
                        <button type="button" role="menuitem" disabled={off} onClick={() => void create(t.kind)} className="focus-ring w-full rounded-[var(--glass-radius-sm)] px-3 py-2 text-left hover:bg-[var(--glass-bg-hover)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent">
                          <span className="flex items-center gap-2 text-sm text-zinc-200">
                            {t.label}
                            {t.local && <span className="rounded-full border border-[var(--glass-border)] px-1.5 text-[10px] text-zinc-400">Local</span>}
                          </span>
                          <span className="block text-xs text-zinc-400">{off ? `Not available here. ${hostWhy}`.trim() : t.description}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
          <p className="mb-6 text-sm text-zinc-400">Flows of connected cards that run on the server, even with this page closed.</p>

          {rows === null ? (
            <p className="text-sm text-zinc-400">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="glass-card rounded-[var(--glass-radius-xl)] border-dashed p-12 text-center">
              <Workflow size={32} className="mx-auto mb-3 text-zinc-500" aria-hidden="true" />
              <p className="text-sm text-zinc-400">No workflows yet. Start from a template, or describe what you want done and DevChat lays out the cards.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => (
                <li key={r.id} className="glass-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--glass-radius-lg)] p-4">
                  <div className="min-w-0 flex-1 basis-48">
                    <Link href={`/workflows/${r.id}`} className="focus-ring block truncate rounded-sm text-sm font-medium text-zinc-200 hover:underline">
                      {r.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {r.cardCount} {r.cardCount === 1 ? "card" : "cards"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    {r.lastRun ? (
                      <>
                        <StatusBadge status={runStatus(r.lastRun.state)} />
                        <span>{getRelativeTime(r.lastRun.startedAt)}</span>
                      </>
                    ) : (
                      <span>Not run</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {r.lastRun?.state === "waiting" && (
                      <Link href={`/workflows/${r.id}`} className="focus-ring glass-button inline-flex h-8 items-center rounded-[var(--glass-radius-md)] px-3 text-sm">
                        Open
                      </Link>
                    )}
                    <button type="button" onClick={() => void run(r)} aria-label={`Run ${r.name}`} className="focus-ring glass-button inline-flex h-8 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-3 text-sm font-medium">
                      <Play size={14} aria-hidden="true" /> Run
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </AppShell>
  );
}
