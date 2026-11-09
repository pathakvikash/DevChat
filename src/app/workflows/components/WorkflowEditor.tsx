"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { History, List, MoreHorizontal, Play, Settings2, Square, Trash2, Workflow, X } from "lucide-react";
import AppShell, { SidebarToggleButton } from "@/app/components/AppShell";
import { useCommandPaletteActions } from "@/app/components/CommandPalette";
import { useToast } from "@/app/components/Toast";
import ModelSelector from "@/app/components/conversation/ModelSelector";
import type { ModelInfo } from "@/app/components/conversation/types";
import SidePanel from "@/app/components/ui/SidePanel";
import { fetchModels } from "@/app/hooks/useModelsApi";
import { CATALOG, type CardType } from "@/lib/workflows/catalog";
import { ancestorsOf, autoLayout, checkGraph, connectNew, MAX_NODES, newCard, TRIGGER_ID, type CardRun, type FlowNode, type WorkflowGraph } from "@/lib/workflows/graph";
import { renderText, renderTemplate, templateRefs, refRoot, type TemplateContext } from "@/lib/workflows/template";
import Canvas, { type AddOptions } from "./Canvas";
import CardList from "./CardList";
import ConfigPanel from "./ConfigPanel";
import type { FieldEnv } from "./ConfigField";
import { pickerRows } from "./FieldPicker";
import { fetchNodeRun, useWorkflowRun } from "./useWorkflowRun";
import RunsDrawer from "./RunsDrawer";
import { formatRunDate, ResumeButton, runStatus, STATUS_META, type RunRow } from "./RunStatus";

interface Wf {
  name: string;
  graph: WorkflowGraph;
}
const KEEPALIVE_MAX_BYTES = 60_000;
type SaveState = "saved" | "saving" | "error";

function useMatchMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

type View = "canvas" | "list";
const VIEW_KEY = "vas:workflowView";
const savedView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "canvas";
  } catch {
    return "canvas";
  }
};

const inputClass = "focus-ring glass-input w-full rounded-[var(--glass-radius-md)] px-3 py-2 text-sm";

export default function WorkflowEditor({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { toast } = useToast();
  const viewRunId = search.get("run");

  const [wf, setWf] = useState<Wf | null>(null);
  const [missing, setMissing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const [runsOpen, setRunsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [chats, setChats] = useState<{ id: string; title: string }[]>([]);
  const [outputs, setOutputs] = useState<Record<string, unknown>>({});
  const [announce, setAnnounce] = useState("");
  const [view, setViewState] = useState<View>(savedView);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };
  const moreRef = useRef<HTMLDivElement>(null);

  const wide = useMatchMedia("(min-width: 1024px)");
  const narrow = !useMatchMedia("(min-width: 768px)");

  const activeRunId = viewRunId ?? liveRunId;
  const { run, restart } = useWorkflowRun(activeRunId);
  const viewingPast = !!viewRunId;
  const readOnly = viewingPast || narrow;

  // ─── Load ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let stop = false;
    (async () => {
      const res = await fetch(`/api/workflows/${id}`);
      if (stop) return;
      if (!res.ok) return setMissing(true);
      const data = await res.json();
      setWf({ name: data.name, graph: data.graph });
      setLiveRunId(data.latestRun?.id ?? null);
    })();
    fetchModels().then((m) => !stop && setModels(m)).catch(() => {});
    fetch("/api/conversations").then((r) => (r.ok ? r.json() : [])).then((list: { id: string; title: string }[]) => !stop && setChats(list.slice(0, 25))).catch(() => {});
    return () => {
      stop = true;
    };
  }, [id]);

  // ─── Saving: a PATCH 800 ms after the last change ───────────────────────
  const wfRef = useRef<Wf | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    wfRef.current = wf;
  });

  const flushRef = useRef<(opts?: { leaving?: boolean }) => Promise<void>>(async () => {});
  const failing = useRef(false);
  // `leaving`: the page is going away, so the request must outlive it (keepalive). Browsers cap a keepalive body at
  // 64 KB, so only a small body gets it; every other PATCH is a plain request.
  const flush = useCallback(
    async (opts: { leaving?: boolean } = {}) => {
      const snapshot = wfRef.current;
      if (!snapshot) return;
      clearTimeout(timer.current);
      const body = JSON.stringify({ name: snapshot.name, graph: snapshot.graph });
      try {
        const res = await fetch(`/api/workflows/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body,
          ...(opts.leaving && new Blob([body]).size < KEEPALIVE_MAX_BYTES ? { keepalive: true } : {}),
        });
        if (res.status >= 400 && res.status < 500) {
          // The server refused this content; sending it again will not change that.
          const refused = await res.json().catch(() => ({}));
          setSaveState("error");
          failing.current = true;
          toast(`Couldn't save. ${refused.error ?? "The server refused the change."}`, "error");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        failing.current = false;
        if (wfRef.current === snapshot) {
          dirty.current = false;
          setSaveState("saved");
        }
      } catch {
        setSaveState("error");
        if (!failing.current) toast("Couldn't save. Retrying…", "error");
        failing.current = true;
        timer.current = setTimeout(() => void flushRef.current(), 3000);
      }
    },
    [id, toast],
  );
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    failing.current = false;
    setSaveState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 800);
  }, [flush]);

  useEffect(() => {
    const leave = () => dirty.current && void flush({ leaving: true });
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      clearTimeout(timer.current);
      leave();
    };
  }, [flush]);

  const edit = useCallback(
    (fn: (w: Wf) => Wf) => {
      setWf((w) => (w ? fn(w) : w));
      scheduleSave();
    },
    [scheduleSave],
  );
  const editGraph = (fn: (g: WorkflowGraph) => WorkflowGraph) => edit((w) => ({ ...w, graph: fn(w.graph) }));
  const editNode = (nodeId: string, patch: Partial<FlowNode>) =>
    editGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)) }));

  function addCard(type: CardType, opts?: AddOptions) {
    if (!wf) return;
    const base = newCard(wf.graph, type);
    const wanted = opts ? { ...base, fromIds: opts.fromId ? [opts.fromId] : base.fromIds, ui: { ...base.ui, position: opts.position ?? base.ui.position } } : base;
    // The same rules as a save: a connection that breaks one is refused, and the card lands unconnected.
    const { node, error } = connectNew(wf.graph, wanted);
    if (error) toast(error, "error");
    editGraph((g) => ({ ...g, nodes: [...g.nodes, node] }));
    setSelectedId(node.id);
  }

  function deleteCard(nodeId: string) {
    const node = wf?.graph.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    if (nodeId === TRIGGER_ID) return toast("The first card starts the flow, so it can't be deleted", "info");
    if (!window.confirm(`Delete “${node.ui.label}”?`)) return;
    // Cards that came after it connect to what it was connected to.
    editGraph((g) => ({
      ...g,
      nodes: g.nodes
        .filter((n) => n.id !== nodeId)
        .map((n) => (n.fromIds.includes(nodeId) ? { ...n, fromIds: [...new Set(n.fromIds.flatMap((f) => (f === nodeId ? node.fromIds : [f])))] } : n)),
    }));
    setSelectedId(null);
  }

  // Canvas edits: positions, connectors (already checked by the canvas with connectionError), and tidy-up.
  const moveCards = (positions: Record<string, { x: number; y: number }>) =>
    editGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (positions[n.id] ? { ...n, ui: { ...n.ui, position: positions[n.id] } } : n)) }));
  const connectCards = (from: string, to: string) => editNode(to, { fromIds: [...(wf?.graph.nodes.find((n) => n.id === to)?.fromIds ?? []), from] });
  const disconnectCards = (from: string, to: string) => editNode(to, { fromIds: (wf?.graph.nodes.find((n) => n.id === to)?.fromIds ?? []).filter((f) => f !== from) });

  // ─── Running ────────────────────────────────────────────────────────────
  async function startRun() {
    if (!wf) return;
    if (dirty.current) await flush();
    const res = await fetch(`/api/workflows/${id}/runs`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.status === 202) {
      setLiveRunId(body.runId);
      if (viewRunId) router.replace(pathname);
      toast("Run started", "success");
      setAnnounce("Run started");
      return;
    }
    toast(`Couldn't start the run. ${body.error ?? "Try again."}`, "error");
    if (body.runId) setLiveRunId(body.runId);
    const first = body.errors?.find((e: { nodeId: string }) => e.nodeId);
    if (first) setSelectedId(first.nodeId);
  }

  async function cancelRun() {
    if (!run) return;
    const res = await fetch(`/api/workflow-runs/${run.id}/cancel`, { method: "POST" });
    if (res.ok) {
      toast("Run cancelled", "info");
      restart();
    } else toast("That run is not running.", "error");
  }

  async function resumeRun() {
    if (!run) return;
    const res = await fetch(`/api/workflow-runs/${run.id}/resume`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.status === 202) {
      setLiveRunId(run.id);
      if (viewRunId) router.replace(pathname);
      restart();
      toast("Run started", "success");
    } else toast(`Couldn't resume the run. ${body.error ?? "Try again."}`, "error");
  }

  // The one live region: announces only the big moments.
  const lastState = useRef<string | null>(null);
  useEffect(() => {
    if (!run) return;
    const prev = lastState.current;
    lastState.current = `${run.id}:${run.state}`;
    if (!prev || prev === lastState.current || !prev.endsWith(":running") || !prev.startsWith(run.id)) return;
    const failedAt = wf?.graph.nodes.find((n) => run.nodes[n.id]?.status === "failed")?.ui.label;
    setAnnounce(
      run.state === "succeeded" ? "Run done" : run.state === "failed" ? `Run failed${failedAt ? ` at ${failedAt}` : ""}` : run.state === "cancelled" ? "Run cancelled" : run.state === "waiting" ? "Run waiting for you" : "",
    );
  }, [run, wf]);

  async function openRuns() {
    setRunsOpen(true);
    setRuns(null);
    const res = await fetch(`/api/workflows/${id}/runs`);
    setRuns(res.ok ? (await res.json()).runs : []);
  }

  // ─── Keys and palette ───────────────────────────────────────────────────
  const startRef = useRef(startRun);
  const runsRef = useRef(openRuns);
  useEffect(() => {
    startRef.current = startRun;
    runsRef.current = openRuns;
  });
  useCommandPaletteActions("Workflow", [
    { id: "workflow-run", label: "Run workflow", icon: <Play size={16} />, shortcut: "⌘↵", onSelect: () => void startRef.current() },
    { id: "workflow-runs", label: "Show runs", icon: <History size={16} />, onSelect: () => void runsRef.current() },
  ]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void startRef.current();
      } else if (e.key === "Escape") {
        // Popovers close themselves first (they stop the event); then the config panel, then the drawer (8.8).
        if (moreOpen) setMoreOpen(false);
        else if (selectedId) setSelectedId(null);
        else if (settingsOpen) setSettingsOpen(false);
        else if (runsOpen) setRunsOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, runsOpen, moreOpen, selectedId]);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: MouseEvent) => !moreRef.current?.contains(e.target as Node) && setMoreOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [moreOpen]);

  // ─── What to show ───────────────────────────────────────────────────────
  const graph = viewingPast && run ? run.graph : wf?.graph;
  const nodes: Record<string, CardRun> = run?.nodes ?? {};
  const issues = useMemo(() => (graph ? checkGraph(graph) : []), [graph]);
  const invalid = useMemo(() => new Set(issues.map((i) => i.nodeId)), [issues]);
  const selected = graph?.nodes.find((n) => n.id === selectedId) ?? null;

  // Outputs of the cards before the selected one, for previews and the field picker. Each is fetched once per run.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!graph || !selected || !run) return;
    for (const a of ancestorsOf(graph, selected.id)) {
      const key = `${run.id}:${a}`;
      if (run.nodes[a]?.status !== "succeeded" || asked.current.has(key)) continue;
      asked.current.add(key);
      void fetchNodeRun(run.id, a).then((c) => {
        if (c) setOutputs((o) => ({ ...o, [key]: c.output ?? null }));
        else asked.current.delete(key);
      }).catch(() => asked.current.delete(key));
    }
  }, [graph, selected, run]);

  const env: FieldEnv | null = useMemo(() => {
    if (!graph || !selected) return null;
    const byId: Record<string, unknown> = {};
    if (run) for (const a of ancestorsOf(graph, selected.id)) if (outputs[`${run.id}:${a}`] !== undefined) byId[a] = outputs[`${run.id}:${a}`];
    const perItem = CATALOG[selected.type].perItem && selected.config.perItem === true;
    const ctx = (item?: unknown): TemplateContext => ({
      nodes: byId,
      vars: Object.fromEntries(graph.vars.map((v) => [v.key, v.value])),
      item,
      index: 1,
      run: { id: run?.id ?? "", date: (run?.startedAt ?? new Date().toISOString()).slice(0, 10), startedAt: run?.startedAt ?? "" },
      workflow: { name: wf?.name ?? "" },
    });
    const list = perItem ? renderTemplate(String(selected.config.items ?? ""), ctx()).value : undefined;
    const sampleItem = Array.isArray(list) ? list[0] : undefined;
    const cardIds = new Set(graph.nodes.map((n) => n.id));
    return {
      rows: pickerRows({ graph, node: selected, perItem, outputs: byId, sampleItem }),
      preview: (tpl) => {
        for (const ref of templateRefs(tpl)) {
          const root = refRoot(ref);
          if ((cardIds.has(root) && byId[root] === undefined) || (root === "item" && sampleItem === undefined)) return null;
        }
        const text = renderText(tpl, ctx(sampleItem)).text.replace(/\s+/g, " ");
        return text.length > 100 ? `${text.slice(0, 100)}…` : text;
      },
      models,
      defaultModel: graph.defaultModel,
      chats,
      readOnly,
      readOnlyReason: narrow ? "narrow" : "past",
    };
  }, [graph, selected, run, outputs, models, chats, readOnly, narrow, wf?.name]);

  if (missing) {
    return (
      <AppShell>
        <main className="p-8 text-[var(--foreground)]">
          <p className="text-sm text-zinc-400">That workflow was not found.</p>
          <Link href="/workflows" className="focus-ring mt-2 inline-block text-sm underline">Back to workflows</Link>
        </main>
      </AppShell>
    );
  }
  if (!wf || !graph) {
    return (
      <AppShell>
        <main className="p-8 text-sm text-zinc-400">Loading…</main>
      </AppShell>
    );
  }

  const showCanvas = !narrow && view === "canvas";
  const live = run && (run.state === "running" || run.state === "waiting");
  const canResume = run && (run.state === "failed" || run.state === "interrupted");
  const interruptedAt = run ? graph.nodes.find((n) => run.nodes[n.id]?.status === "running" || run.nodes[n.id]?.status === "failed")?.ui.label : undefined;
  const interruptedNode = run ? graph.nodes.find((n) => run.nodes[n.id]?.status === "running") : undefined;
  const interruptedCard = interruptedNode && run ? run.nodes[interruptedNode.id] : undefined;
  const panel = selected && env && (
    <ConfigPanel
      key={selected.id}
      node={selected}
      graph={graph}
      card={nodes[selected.id]}
      runId={run?.id ?? null}
      runState={run?.state}
      issues={issues}
      env={env}
      overlay={!wide}
      onChange={(patch) => editNode(selected.id, patch)}
      onDelete={() => deleteCard(selected.id)}
      onClose={() => setSelectedId(null)}
    />
  );

  return (
    <AppShell>
      <div className="flex h-full flex-col text-[var(--foreground)]">
        <header className="glass-nav relative z-20 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <SidebarToggleButton />
          <input
            aria-label="Workflow name"
            value={wf.name}
            readOnly={narrow || viewingPast}
            onChange={(e) => edit((w) => ({ ...w, name: e.target.value }))}
            className={`${inputClass} !w-auto min-w-0 flex-1 basis-40 !text-lg font-bold`}
          />
          <span className="text-xs text-zinc-400">
            {saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn't save. Retrying…" : "Saved"}
          </span>
          {live && !viewingPast && <span className="text-xs text-zinc-400">A run is in progress. Changes apply to the next run.</span>}
          <div className="ml-auto flex items-center gap-2">
            {!narrow && (
              <div role="group" aria-label="View" className="glass-button flex rounded-[var(--glass-radius-md)] p-0.5 text-xs">
                {([["canvas", "Canvas", Workflow], ["list", "List", List]] as const).map(([v, label, Icon]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={`focus-ring inline-flex h-7 items-center gap-1.5 rounded-[calc(var(--glass-radius-md)-2px)] px-2.5 font-medium ${view === v ? "glass-button-primary text-[var(--foreground)]" : "text-zinc-400 hover:text-zinc-200"}`}
                  >
                    <Icon size={14} aria-hidden="true" /> {label}
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={() => void openRuns()} className="focus-ring glass-button inline-flex h-8 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-3 text-sm">
              <History size={14} aria-hidden="true" /> Runs
            </button>
            <div ref={moreRef} className="relative">
              <button type="button" aria-label="More" title="More" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((m) => !m)} className="focus-ring glass-button flex h-8 w-8 items-center justify-center rounded-[var(--glass-radius-md)]">
                <MoreHorizontal size={16} />
              </button>
              {moreOpen && (
                <ul role="menu" className="glass-panel-strong absolute right-0 top-full z-50 mt-1 w-56 rounded-[var(--glass-radius-md)] p-1 shadow-lg">
                  {!narrow && (
                    <li role="none">
                      <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); setSettingsOpen(true); }} className="focus-ring flex w-full items-center gap-3 rounded-[var(--glass-radius-sm)] px-3 py-2 text-sm hover:bg-[var(--glass-bg-hover)]">
                        <Settings2 size={14} aria-hidden="true" /> Workflow settings
                      </button>
                    </li>
                  )}
                  <li role="none">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={async () => {
                        setMoreOpen(false);
                        if (!window.confirm(`Delete “${wf.name}” and its runs?`)) return;
                        const res = await fetch(`/api/workflows/${id}`, { method: "DELETE" });
                        if (res.ok) router.push("/workflows");
                        else toast("Couldn't delete the workflow. Try again.", "error");
                      }}
                      className="focus-ring flex w-full items-center gap-3 rounded-[var(--glass-radius-sm)] px-3 py-2 text-sm hover:bg-[var(--glass-bg-hover)]"
                    >
                      <Trash2 size={14} aria-hidden="true" /> Delete
                    </button>
                  </li>
                </ul>
              )}
            </div>
            {live && !viewingPast && (
              <button type="button" onClick={() => void cancelRun()} className="focus-ring glass-button-danger inline-flex h-8 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-3 text-sm font-medium">
                <Square size={14} aria-hidden="true" /> Cancel run
              </button>
            )}
            <button type="button" onClick={() => void startRun()} title="Run (⌘↵)" className="focus-ring glass-button-primary inline-flex h-8 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-3 text-sm font-medium text-white">
              <Play size={14} aria-hidden="true" /> Run
            </button>
          </div>
        </header>

        {(viewingPast || canResume) && run && (
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--glass-border)] px-4 py-2 text-sm">
            {viewingPast && (
              <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs text-zinc-300">
                Run · {formatRunDate(run.startedAt)} · {STATUS_META[runStatus(run.state)].label}
                <button type="button" aria-label="Back to the workflow" title="Back to the workflow" onClick={() => router.replace(pathname)} className="focus-ring rounded-full text-zinc-400 hover:text-[var(--foreground)]">
                  <X size={14} />
                </button>
              </span>
            )}
            {canResume && <ResumeButton onClick={() => void resumeRun()} at={run.state === "interrupted" ? interruptedAt : undefined} />}
            {run.state === "interrupted" && interruptedAt && (
              <span className="text-xs text-zinc-300">
                {interruptedCard?.partial
                  ? `Resume keeps the ${Object.keys(interruptedCard.partial.results).length} items “${interruptedAt}” already finished.`
                  : `Resume starts “${interruptedAt}” again from the beginning. If that one card alone runs longer than the host's time limit, it will stop again.`}
              </span>
            )}
            {run.error && <span className="text-xs text-zinc-300">{run.error}</span>}
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <main className={`min-w-0 flex-1 ${showCanvas ? "relative" : "overflow-y-auto"}`}>
            {showCanvas ? (
              <Canvas graph={graph} nodes={nodes} runState={run?.state} selectedId={selectedId} invalid={invalid} readOnly={readOnly} onSelect={setSelectedId} onAdd={addCard} onMove={moveCards} onConnect={connectCards} onDisconnect={disconnectCards} onDelete={deleteCard} onTidy={() => editGraph(autoLayout)} />
            ) : (
            <CardList canAdd={graph.nodes.length < MAX_NODES} graph={graph} nodes={nodes} runState={run?.state} selectedId={selectedId} invalid={invalid} readOnly={readOnly} onSelect={setSelectedId} onAdd={addCard} />
            )}
          </main>
          {wide && panel}
        </div>
        {!wide && panel && (
          <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedId(null)} />
            <div className="glass-panel-strong relative h-full w-full max-w-md">{panel}</div>
          </div>
        )}

        <p className="sr-only" aria-live="polite">{announce}</p>
      </div>

      <RunsDrawer
        open={runsOpen}
        onClose={() => setRunsOpen(false)}
        runs={runs}
        currentId={activeRunId}
        onOpen={(rid) => {
          setRunsOpen(false);
          router.push(`${pathname}?run=${rid}`);
        }}
      />

      <SidePanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} title="Workflow settings">
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-200">Variables</h3>
          <p className="text-xs text-zinc-400">Text your cards can use as {"{{vars.key}}"}. Don&apos;t put passwords or keys here.</p>
          {wf.graph.vars.map((v, i) => (
            <div key={i} className="glass-card space-y-1.5 rounded-[var(--glass-radius-md)] p-2">
              <div className="flex gap-1.5">
                <input aria-label="Variable label" placeholder="label" value={v.label} onChange={(e) => editGraph((g) => ({ ...g, vars: g.vars.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))} className={`${inputClass} !px-2 !py-1`} />
                <input aria-label="Variable key" placeholder="key" value={v.key} onChange={(e) => editGraph((g) => ({ ...g, vars: g.vars.map((x, j) => (j === i ? { ...x, key: e.target.value.replace(/[^\w-]/g, "") } : x)) }))} className={`${inputClass} !w-32 !px-2 !py-1 font-mono`} />
                <button type="button" aria-label={`Remove variable ${v.key}`} title="Remove variable" onClick={() => editGraph((g) => ({ ...g, vars: g.vars.filter((_, j) => j !== i) }))} className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--glass-radius-sm)] text-zinc-400 hover:bg-[var(--glass-bg-hover)]">
                  <X size={14} />
                </button>
              </div>
              <textarea aria-label={`Value of ${v.key || "variable"}`} rows={3} value={v.value} onChange={(e) => editGraph((g) => ({ ...g, vars: g.vars.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) }))} className={`${inputClass} resize-y`} />
            </div>
          ))}
          <button type="button" onClick={() => editGraph((g) => ({ ...g, vars: [...g.vars, { key: `var${g.vars.length + 1}`, label: "", value: "" }] }))} className="focus-ring glass-button h-8 rounded-[var(--glass-radius-md)] px-3 text-sm">
            Add variable
          </button>
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-200">Default model</h3>
          <p className="text-xs text-zinc-400">Agent cards with no model of their own use this one.</p>
          <ModelSelector currentModel={wf.graph.defaultModel} onModelChange={(m) => editGraph((g) => ({ ...g, defaultModel: m }))} />
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-200">Token limit per run</h3>
          <input
            key={wf.graph.maxRunTokens}
            aria-label="Token limit per run"
            type="number"
            min={1000}
            max={5_000_000}
            step={10000}
            defaultValue={wf.graph.maxRunTokens}
            onBlur={(e) => {
              // Clamped when you leave the field, so typing a new number is not fought halfway.
              const n = Math.round(Math.min(5_000_000, Math.max(1000, Number(e.target.value) || 500_000)));
              editGraph((g) => ({ ...g, maxRunTokens: n }));
            }}
            className={`${inputClass} !w-40 font-mono`}
          />
        </section>
      </SidePanel>
    </AppShell>
  );
}
