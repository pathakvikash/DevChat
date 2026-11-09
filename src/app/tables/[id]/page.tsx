"use client";

import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, ExternalLink, Lock, Search, Sheet, ShieldQuestion, Table2, Trash2 } from "lucide-react";
import AppShell, { SidebarToggleButton } from "@/app/components/AppShell";
import { useToast } from "@/app/components/Toast";
import { connectHref } from "@/app/components/GoogleConnection";
import { kindsText } from "@/lib/workflows/privacy";
import type { CardRun } from "@/lib/workflows/graph";
import type { Column } from "@/lib/workflows/tables";
import RowDrawer, { cellText, isHttpUrl, type TableRow } from "../components/RowDrawer";

interface Table {
  id: string;
  name: string;
  columns: Column[];
  statuses: string[];
  rowCount: number;
  private: boolean;
  privateKinds: string[];
  sheetUrl: string | null;
}

const inputClass = "focus-ring glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm";
const LONG_PREVIEW = 80;
// Sticky cells sit over the cells that scroll under them, so they need a solid background.
const stickyCell = "sticky z-[1] bg-[var(--background)]";
// The sticky first column stays narrow on a phone, so the columns after it stay in reach.
const firstCol = "max-w-[10rem] sm:max-w-xs";
/** The most rows one bulk action takes (the API's limit). */
const MAX_PICK = 1000;
const TOO_MANY = "You can change up to 1,000 rows at a time.";

/** A run that waits for rows from this table (8.7): which run and card, and what the card offers. */
interface PickState {
  runId: string;
  workflowId: string;
  nodeId: string;
  w: NonNullable<CardRun["waiting"]>;
}

/** Highest first; numbers as numbers, anything else as text, empty cells last. */
function bySortColumn(key: string) {
  return (a: TableRow, b: TableRow) => {
    const x = a.data[key];
    const y = b.data[key];
    if ((x === undefined || x === null || x === "") !== (y === undefined || y === null || y === "")) return x === undefined || x === null || x === "" ? 1 : -1;
    return typeof x === "number" && typeof y === "number" ? y - x : cellText(y).localeCompare(cellText(x));
  };
}

/** A checkbox with a 32px hit area around the 16px box. */
function Tick({ label, checked, indeterminate, disabled, onChange }: { label: string; checked: boolean; indeterminate?: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={`flex h-8 w-8 items-center justify-center ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} ref={(el) => { if (el) el.indeterminate = !!indeterminate; }} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
    </label>
  );
}

/** A row's status. A mouse pick commits at once; arrow keys only move the choice, which commits on Enter or when focus leaves. */
function StatusSelect({ label, value, options, onCommit }: { label: string; value: string; options: string[]; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const keyed = useRef(false);
  const commit = (v: string) => {
    keyed.current = false;
    if (v !== value) onCommit(v);
  };
  return (
    <select
      aria-label={label}
      value={draft}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(draft);
        else if (e.key.startsWith("Arrow")) keyed.current = true;
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        if (!keyed.current) commit(e.target.value);
      }}
      onBlur={() => commit(draft)}
      className="focus-ring glass-input h-8 rounded-[var(--glass-radius-sm)] px-2 text-xs"
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

export default function TablePage({ params }: { params: Promise<{ id: string }> }) {
  // useSearchParams (pick mode) needs a Suspense boundary above it.
  return (
    <Suspense fallback={null}>
      <TableView params={params} />
    </Suspense>
  );
}

function TableView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { toast } = useToast();
  const router = useRouter();
  const pickRunId = useSearchParams().get("pick");
  // Pick mode: undefined while the run loads, null when that run is not waiting for rows from this table.
  const [pick, setPick] = useState<PickState | null | undefined>(undefined);
  const [showAll, setShowAll] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [table, setTable] = useState<Table | null>(null);
  const [missing, setMissing] = useState(false);
  const [rows, setRows] = useState<TableRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<TableRow | null>(null);
  const [syncing, setSyncing] = useState(false);
  // True after Google refused a refresh: the button turns into Reconnect Google.
  const [reconnect, setReconnect] = useState(false);
  const resumed = useRef(false);
  const syncingRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(t);
  }, [typed]);

  useEffect(() => {
    let stop = false;
    fetch(`/api/tables/${id}`)
      .then(async (res) => {
        if (stop) return;
        if (res.ok) setTable(await res.json());
        else setMissing(true);
      })
      .catch(() => !stop && setMissing(true));
    return () => {
      stop = true;
    };
  }, [id]);

  /** Overwrites the table's Google sheet. Not connected yet: goes to Google first and comes back here to finish. */
  // Where Google sends the user back to: this table, still in pick mode if it was.
  const back = `/tables/${id}?sync=1${pickRunId ? `&pick=${encodeURIComponent(pickRunId)}` : ""}`;
  const sync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    const res = await fetch(`/api/tables/${id}/sheet-sync`, { method: "POST" }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    syncingRef.current = false;
    setSyncing(false);
    if (res?.ok) {
      setReconnect(false);
      setTable((t) => (t ? { ...t, sheetUrl: body.sheetUrl } : t));
      return toast(`Synced ${body.rows} ${body.rows === 1 ? "row" : "rows"} to Google Sheets`, "success");
    }
    if (res?.status === 409 && body.reconnect) {
      if (!body.connected) return void (window.location.href = connectHref(back));
      setReconnect(true);
    }
    toast(res ? body.error ?? "Couldn't sync. Try again." : "Couldn't reach the server.", "error");
  }, [id, back, toast]);

  // A refusal remembered from an earlier visit shows Reconnect Google at once.
  useEffect(() => {
    let stop = false;
    fetch("/api/integrations/google")
      .then((r) => (r.ok ? r.json() : null))
      .then((g) => !stop && g?.reconnect && setReconnect(true))
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, []);

  // Back from Google: finish the sync that started the trip.
  useEffect(() => {
    if (resumed.current || !table) return;
    resumed.current = true;
    const q = new URLSearchParams(window.location.search);
    const flag = q.get("google");
    if (!flag) return;
    const wantSync = !!q.get("sync");
    // Take only the Google flags out of the address: ?pick= stays.
    q.delete("google");
    q.delete("sync");
    window.history.replaceState(null, "", `${window.location.pathname}${q.size ? `?${q}` : ""}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- finishes the sync once, when the page is first loaded back from Google
    if (flag === "connected" && wantSync) void sync();
    else if (flag === "scope") toast("Google didn't give DevChat access to the sheets it creates. Try again and keep that box ticked.", "error");
    else if (flag !== "connected") toast("Google wasn't connected. Try again.", "error");
  }, [table, sync, toast]);

  // Pick mode: which waiting card of which run asks for rows from this table.
  useEffect(() => {
    if (!pickRunId) return;
    let stop = false;
    fetch(`/api/workflow-runs/${pickRunId}`)
      .then(async (res) => {
        const run = res.ok ? await res.json() : null;
        const nodeId = run?.state === "waiting" ? Object.keys(run.nodes).find((k) => run.nodes[k].status === "waiting" && run.nodes[k].waiting?.tableId === id) : undefined;
        if (!stop) setPick(run && nodeId ? { runId: run.id, workflowId: run.workflowId, nodeId, w: run.nodes[nodeId].waiting } : null);
      })
      .catch(() => !stop && setPick(null));
    return () => {
      stop = true;
    };
  }, [pickRunId, id]);
  const pickReady = !pickRunId || pick !== undefined;
  // In pick mode the grid shows the statuses on offer, until "Show all rows".
  const offered = pick && !showAll ? pick.w.statuses : null;
  const offeredKey = offered ? offered.join("\n") : "";

  /** One page of rows for the current search and status: the first, or the one after `after`. Null when the request failed. */
  const fetchPage = useCallback(
    async (after?: string): Promise<{ rows: TableRow[]; nextCursor: string | null } | null> => {
      const url = new URLSearchParams();
      if (q) url.set("q", q);
      if (offeredKey) for (const s of offeredKey.split("\n")) url.append("status", s);
      else if (status) url.set("status", status);
      if (after) url.set("cursor", after);
      const res = await fetch(`/api/tables/${id}/rows?${url}`).catch(() => null);
      return res?.ok ? res.json() : null;
    },
    [id, q, status, offeredKey],
  );
  useEffect(() => {
    if (!pickReady) return;
    let stop = false; // a newer search is on its way: this answer is dropped
    void fetchPage().then((page) => {
      if (stop) return;
      if (!page) {
        setRows((r) => r ?? []);
        return toast("Couldn't load the rows. Try again.", "error");
      }
      setRows(page.rows);
      setCursor(page.nextCursor);
      setPicked(new Set()); // a new search or filter starts with nothing ticked
    });
    return () => {
      stop = true;
    };
  }, [fetchPage, toast, pickReady]);

  async function loadMore() {
    // After the cursor row is deleted the server could not find it, so the cursor is the last row still on screen.
    const last = rows?.at(-1)?.id;
    const page = last ? await fetchPage(last) : null;
    if (!page) return toast("Couldn't load more rows. Try again.", "error");
    setRows((r) => [...(r ?? []), ...page.rows]);
    setCursor(page.nextCursor);
  }

  const columns = table?.columns ?? [];
  // The status sits right after the first column, so it stays on screen when the rest scroll sideways.
  const layout: { col?: Column; first?: boolean }[] = [...columns.slice(0, 1).map((col) => ({ col, first: true })), {}, ...columns.slice(1).map((col) => ({ col }))];
  const first = columns[0]?.key;
  const titleOf = (r: TableRow) => (first ? cellText(r.data[first]) : "").slice(0, 60) || "row";
  const visible = useMemo(() => (pick?.w.sortBy ? [...(rows ?? [])].sort(bySortColumn(pick.w.sortBy)) : (rows ?? [])), [rows, pick]);
  const allPicked = visible.length > 0 && visible.every((r) => picked.has(r.id));
  const maxPick = pick?.w.maxPick ?? MAX_PICK;
  const tick = (id: string, on: boolean) => {
    if (on && picked.size >= maxPick && !picked.has(id)) return toast(pick ? `Up to ${maxPick}` : TOO_MANY, "info");
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  };

  async function setStatusOf(ids: string[], next: string) {
    const res = await fetch(`/api/tables/${id}/rows`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, status: next }) });
    if (!res.ok) return toast(`Couldn't change the status. ${(await res.json().catch(() => ({}))).error ?? "Try again."}`, "error");
    const set = new Set(ids);
    // With a status filter on, a row that no longer matches leaves the grid.
    setRows((r) => (r ?? []).flatMap((x) => (set.has(x.id) ? (status && status !== next ? [] : [{ ...x, status: next }]) : [x])));
    toast(ids.length === 1 ? `Status set to ${next}` : `${ids.length} rows set to ${next}`, "success");
  }

  /** Hands the ticked rows to the waiting card (6.4). The run goes on in the background; the workflow page shows it. */
  async function continueRun(ids: string[]) {
    if (!pick || continuing) return;
    setContinuing(true);
    const res = await fetch(`/api/workflow-runs/${pick.runId}/resume`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nodeId: pick.nodeId, rowIds: ids }) });
    if (res.status === 202) {
      toast("Run continued", "success");
      router.push(`/workflows/${pick.workflowId}`);
      return;
    }
    setContinuing(false);
    toast(`Couldn't continue the run. ${(await res.json().catch(() => ({}))).error ?? "Try again."}`, "error");
  }

  async function deletePicked() {
    const ids = [...picked];
    if (!window.confirm(`Delete ${ids.length} ${ids.length === 1 ? "row" : "rows"}? This can't be undone.`)) return;
    const res = await fetch(`/api/tables/${id}/rows`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    if (!res.ok) return toast("Couldn't delete the rows. Try again.", "error");
    setRows((r) => (r ?? []).filter((x) => !picked.has(x.id)));
    setPicked(new Set());
    setTable((t) => (t ? { ...t, rowCount: Math.max(0, t.rowCount - ids.length) } : t));
    toast(`${ids.length} ${ids.length === 1 ? "row" : "rows"} deleted`, "success");
  }

  const statuses = useMemo(() => (table ? [...new Set([...table.statuses, ...visible.map((r) => r.status)])] : []), [table, visible]);

  if (missing) {
    return (
      <AppShell>
        <main className="p-8 text-[var(--foreground)]">
          <p className="text-sm text-zinc-400">That table was not found.</p>
          <Link href="/tables" className="focus-ring mt-2 inline-block text-sm underline">Back to tables</Link>
        </main>
      </AppShell>
    );
  }
  if (!table) {
    return (
      <AppShell>
        <main className="p-8 text-sm text-zinc-400">Loading…</main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="min-h-full p-4 text-[var(--foreground)] sm:p-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <SidebarToggleButton />
            <Table2 size={28} className="shrink-0 text-emerald-400" aria-hidden="true" />
            <div className="min-w-0 flex-1 basis-40">
              <h1 className="truncate text-xl font-bold sm:text-2xl">{table.name}</h1>
              <p className="text-xs text-zinc-400">
                {table.rowCount.toLocaleString("en-US")} {table.rowCount === 1 ? "row" : "rows"}
              </p>
              {table.private && (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-zinc-300">
                  <span className="glass inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium">
                    <Lock size={11} aria-hidden="true" /> Private
                  </span>
                  <span>{`Filled from ${kindsText(table.privateKinds)}. Workflows can't send what is in it to the web.`}</span>
                </p>
              )}
            </div>
            {table.sheetUrl && (
              <a href={table.sheetUrl} target="_blank" rel="noopener noreferrer" className="focus-ring glass-button inline-flex h-9 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-3 text-sm font-medium">
                <ExternalLink size={14} aria-hidden="true" /> Open sheet
              </a>
            )}
            {reconnect ? (
              <a href={connectHref(back)} className="focus-ring glass-button-primary inline-flex h-9 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-3 text-sm font-medium text-white">
                <Sheet size={14} aria-hidden="true" /> Reconnect Google
              </a>
            ) : (
              <button type="button" onClick={() => void sync()} aria-disabled={syncing} className="focus-ring glass-button aria-disabled:opacity-60 inline-flex h-9 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-3 text-sm font-medium">
                <Sheet size={14} aria-hidden="true" /> {syncing ? "Syncing…" : "Sync to Google Sheets"}
              </button>
            )}
            <a href={`/api/tables/${id}/export`} download className="focus-ring glass-button inline-flex h-9 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-3 text-sm font-medium">
              <Download size={14} aria-hidden="true" /> Export CSV
            </a>
          </div>

          {pick && (
            <div data-testid="pick-banner" className="glass-card mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--glass-radius-md)] border-amber-900/50 px-4 py-2 text-sm">
              <ShieldQuestion size={16} className="shrink-0 text-amber-400" aria-hidden="true" />
              <span className="min-w-0 flex-1 basis-60 text-zinc-200">{`Pick up to ${maxPick} ${maxPick === 1 ? "row" : "rows"}${pick.w.message ? ` for “${pick.w.message}”` : ""}, then continue.`}</span>
              <span className="text-xs tabular-nums text-zinc-300">
                {picked.size} picked{picked.size >= maxPick ? ` · Up to ${maxPick}` : ""}
              </span>
              <button type="button" disabled={continuing} onClick={() => (picked.size === 0 || window.confirm(`Continue without the ${picked.size} ticked ${picked.size === 1 ? "row" : "rows"}?`)) && void continueRun([])} className="focus-ring glass-button inline-flex h-8 items-center rounded-[var(--glass-radius-md)] px-3 text-sm disabled:opacity-50">
                Continue with none
              </button>
              <button type="button" disabled={continuing || picked.size === 0} onClick={() => void continueRun([...picked])} className="focus-ring glass-button-primary inline-flex h-8 items-center rounded-[var(--glass-radius-md)] px-3 text-sm font-medium text-white disabled:opacity-50">
                Continue run ({picked.size})
              </button>
            </div>
          )}
          {pickRunId && pick === null && (
            <p className="mb-3 text-sm text-zinc-300">
              That run is not waiting for rows from this table any more.{" "}
              <Link href="/workflows" className="focus-ring text-blue-400 underline">Back to workflows</Link>
            </p>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-48">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
              <input type="search" aria-label="Search rows" placeholder="Search rows…" value={typed} onChange={(e) => setTyped(e.target.value)} className={`${inputClass} w-full pl-9`} />
            </div>
            {offered ? (
              <>
                <span className="text-xs text-zinc-300">{`Showing rows with status ${offered.join(", ")}`}</span>
                <button type="button" onClick={() => setShowAll(true)} className="focus-ring glass-button h-9 rounded-[var(--glass-radius-md)] px-3 text-sm">
                  Show all rows
                </button>
              </>
            ) : (
              <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
                <option value="">All statuses</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
            {pick && showAll && (
              <button type="button" onClick={() => setShowAll(false)} className="focus-ring glass-button h-9 rounded-[var(--glass-radius-md)] px-3 text-sm">
                Show only rows on offer
              </button>
            )}
            {picked.size > 0 && !pick && (
              <>
                <select
                  aria-label={`Set status of ${picked.size} selected`}
                  value=""
                  onChange={(e) => e.target.value && void setStatusOf([...picked], e.target.value)}
                  className={inputClass}
                >
                  <option value="">Set status ▾</option>
                  {statuses.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button type="button" onClick={() => void deletePicked()} className="focus-ring glass-button-danger inline-flex h-9 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-3 text-sm font-medium">
                  <Trash2 size={14} aria-hidden="true" /> Delete
                </button>
              </>
            )}
          </div>

          {rows === null ? (
            <p className="text-sm text-zinc-400">Loading…</p>
          ) : visible.length === 0 ? (
            <div className="glass-card rounded-[var(--glass-radius-xl)] border-dashed p-12 text-center">
              <Table2 size={32} className="mx-auto mb-3 text-zinc-500" aria-hidden="true" />
              <p className="text-sm text-zinc-400">{q || status ? "No rows match." : "No rows yet. Run a workflow that saves here."}</p>
            </div>
          ) : (
            <div className="glass-card max-h-[70vh] overflow-auto rounded-[var(--glass-radius-lg)]">
              <table className="w-full min-w-max border-collapse text-left text-sm">
                <thead className="sticky top-0 z-[2] bg-[var(--background)] text-xs text-zinc-300">
                  <tr className="border-b border-[var(--glass-border)]">
                    <th scope="col" className={`${stickyCell} left-0 w-14 px-3 py-2`}>
                      {pick ? (
                        <span className="sr-only">Pick</span> // the card's limit is on the banner: no select-all
                      ) : (
                        <Tick
                          label="Select all rows"
                          checked={allPicked}
                          indeterminate={picked.size > 0 && !allPicked}
                          onChange={() => {
                            // Anything ticked: one click clears it. Nothing ticked: tick the rows, at most 1,000 of them.
                            if (picked.size === 0 && visible.length > MAX_PICK) toast(TOO_MANY, "info");
                            setPicked(picked.size > 0 ? new Set() : new Set(visible.slice(0, MAX_PICK).map((r) => r.id)));
                          }}
                        />
                      )}
                    </th>
                    {layout.map((l) =>
                      l.col ? (
                        <th key={l.col.key} scope="col" className={`px-3 py-2 font-medium ${l.first ? `${stickyCell} left-14 ${firstCol}` : ""}`}>
                          {l.col.label || l.col.key}
                        </th>
                      ) : (
                        <th key="status" scope="col" className="px-3 py-2 font-medium">Status</th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--glass-border)] last:border-b-0">
                      <td className={`${stickyCell} left-0 px-3 py-2`}>
                        <Tick label={`Select ${titleOf(r)}`} checked={picked.has(r.id)} disabled={!!pick && !pick.w.statuses.includes(r.status)} onChange={(on) => tick(r.id, on)} />
                      </td>
                      {layout.map((l) => {
                        if (!l.col) {
                          return (
                            <td key="status" className="px-3 py-2">
                              <StatusSelect label={`Status of ${titleOf(r)}`} value={r.status} options={statuses} onCommit={(v) => void setStatusOf([r.id], v)} />
                            </td>
                          );
                        }
                        const c = l.col;
                        const text = cellText(r.data[c.key]);
                        const sticky = l.first ? `${stickyCell} left-14 ${firstCol}` : "max-w-xs";
                        let body: React.ReactNode = text;
                        if (c.type === "url" && isHttpUrl(text)) {
                          body = (
                            <a href={text} target="_blank" rel="noopener noreferrer" title={text} className="focus-ring text-blue-400 underline">
                              {text}
                            </a>
                          );
                        } else if (c.type === "longtext" && text.length > LONG_PREVIEW) {
                          body = (
                            <>
                              {text.slice(0, LONG_PREVIEW)}…{" "}
                              <button type="button" onClick={() => setOpen(r)} aria-label={`Open ${titleOf(r)}`} className="focus-ring text-blue-400 underline">
                                Open
                              </button>
                            </>
                          );
                        } else if (l.first && text) {
                          body = (
                            <button type="button" onClick={() => setOpen(r)} title={text} className="focus-ring max-w-full truncate text-left hover:underline">
                              {text}
                            </button>
                          );
                        }
                        return (
                          <td key={c.key} title={text} className={`truncate px-3 py-2 text-zinc-200 ${sticky}`}>
                            {body}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cursor && (
            <div className="mt-3 flex justify-center">
              <button type="button" onClick={() => void loadMore()} className="focus-ring glass-button h-9 rounded-[var(--glass-radius-md)] px-4 text-sm">
                Load more
              </button>
            </div>
          )}
        </div>
      </main>
      <RowDrawer row={open} columns={columns} title={open ? titleOf(open) : ""} onClose={() => setOpen(null)} />
    </AppShell>
  );
}
