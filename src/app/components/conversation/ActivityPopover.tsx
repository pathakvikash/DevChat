"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Activity, Brain, Cpu, FolderOpen, ListChecks, Plug, FileCode, Gauge, Square, ListTodo, X } from "lucide-react";
import { useResource } from "@/app/hooks/useResource";
import { shortenHome } from "@/app/hooks/useFolders";
import { elapsed, finishedHelpers, runningCount, type BgTask } from "@/lib/chat/backgroundTasks";
import type { PanelView } from "@/lib/chatPanel";
import { fetchMcpServers, type McpServerRow } from "@/app/components/panel/ConnectorsView";
import { useTick } from "@/app/components/panel/useTick";

interface ArtifactRow {
  id: string;
  title: string;
  type: string;
}

const RECENT_OUTPUTS = 5;

async function fetchArtifacts(conversationId: string): Promise<ArtifactRow[]> {
  const res = await fetch(`/api/conversations/${conversationId}/artifacts`);
  if (!res.ok) throw new Error(`Failed to load outputs: ${res.status}`);
  return (await res.json()).artifacts ?? [];
}

/** Everything the popover needs; the pane owns all of it. */
export interface ActivityProps {
  conversationId: string;
  modelName: string;
  folder: string | null;
  /** Host tools are on: the Folder row shows. */
  hostTools: boolean;
  temporary: boolean;
  memoryOn: boolean;
  onToggleMemory: () => void;
  context: { contextPercent: number; usedTokens: number; maxContextTokens: number } | null;
  tasks: BgTask[];
  todosOpen: number;
  onOpenView: (view: PanelView, item?: string) => void;
  onFocusModel: () => void;
  onFocusFolder: () => void;
  onStopReply: () => void;
  onRemoveQueued: (id: string) => void;
  onStopAgents: () => void;
  onClose: () => void;
}

/** The header's Activity button, with the number of things going on. */
export function ActivityButton({
  open,
  count,
  onClick,
}: {
  open: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-activity-button
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={count > 0 ? `Activity, ${count} active` : "Activity"}
      title="Activity (⌥A)"
      className={`focus-ring relative flex size-8 shrink-0 items-center justify-center rounded-[var(--glass-radius-md)] ${open ? "glass-strong" : "glass-button"} text-[var(--foreground)]`}
    >
      <Activity size={16} aria-hidden />
      {count > 0 && (
        <span aria-hidden className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white">
          {count}
        </span>
      )}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-[var(--glass-border)] py-1 first:border-t-0">
      <h3 className="px-3 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--foreground)]/55">{title}</h3>
      {children}
    </section>
  );
}

const ROW = "focus-ring flex w-full items-center gap-2 rounded-[var(--glass-radius-sm)] px-3 py-1.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)]";

/** The popover itself. The parent mounts it while open, so its fetches run once per opening. */
export default function ActivityPopover(p: ActivityProps) {
  const root = useRef<HTMLDivElement>(null);
  const artifacts = useResource<ArtifactRow[]>(() => fetchArtifacts(p.conversationId), [p.conversationId]);
  const servers = useResource<McpServerRow[]>(fetchMcpServers, []);
  const now = useTick(runningCount(p.tasks) > 0);

  // Focus goes to the first row; a click outside closes.
  useEffect(() => {
    root.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);
  const { onClose } = p;
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      // The Activity button toggles by itself.
      if (root.current?.contains(target) || (target as Element).closest?.("[data-activity-button]")) return;
      onClose();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [onClose]);

  const open = (view: PanelView, item?: string) => {
    p.onClose();
    p.onOpenView(view, item);
  };

  const outputs = artifacts.data ?? [];
  const list = servers.data ?? [];
  const connected = list.filter((s) => s.enabled).length;
  const failing = list.some((s) => s.enabled && s.errorMsg);
  const pct = p.context ? Math.round(p.context.contextPercent) : null;
  const finished = finishedHelpers(p.tasks).length;
  const active = p.tasks.filter((t) => t.status === "running" || t.status === "queued");
  const barColor = pct == null ? "" : pct < 70 ? "bg-emerald-500" : pct < 90 ? "bg-amber-400" : "bg-red-500";

  return (
    <div
      ref={root}
      role="dialog"
      aria-label="Activity"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        p.onClose();
        document.querySelector<HTMLElement>(`[data-pane-id="${p.conversationId}"] [data-activity-button]`)?.focus();
      }}
      onBlur={(e) => {
        // Focus left the popover (and did not land on its own button).
        const next = e.relatedTarget as Element | null;
        if (next && !root.current?.contains(next) && !next.closest?.("[data-activity-button]")) p.onClose();
      }}
      className="glass-panel-strong absolute right-2 top-full z-[60] mt-1 max-h-[70vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[var(--glass-radius-md)] border border-[var(--glass-border-strong)] p-1 shadow-lg outline-none sm:right-0 sm:w-80"
    >
      <Section title="Environment">
        <button type="button" className={ROW} onClick={() => { p.onClose(); p.onFocusModel(); }}>
          <Cpu size={14} className="shrink-0 text-[var(--foreground)]/60" aria-hidden />
          <span className="shrink-0">Model</span>
          <span className="ml-auto min-w-0 truncate text-xs text-[var(--foreground)]/65">{p.modelName || "Default"}</span>
        </button>
        {p.hostTools && (
          <button type="button" className={ROW} onClick={() => (p.folder ? open("files") : (p.onClose(), p.onFocusFolder()))}>
            <FolderOpen size={14} className="shrink-0 text-[var(--foreground)]/60" aria-hidden />
            <span className="shrink-0">Folder</span>
            <span className="ml-auto min-w-0 truncate text-xs text-[var(--foreground)]/65" title={p.folder ?? undefined}>{p.folder ? shortenHome(p.folder) : "No folder"}</span>
          </button>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={!p.temporary && p.memoryOn}
          // aria-disabled, not disabled, so the row stays readable and focusable.
          aria-disabled={p.temporary || undefined}
          title={p.temporary ? "Temporary chats have no memory" : undefined}
          onClick={() => { if (!p.temporary) p.onToggleMemory(); }}
          className={`${ROW} ${p.temporary ? "opacity-60" : ""}`}
        >
          <Brain size={14} className="shrink-0 text-[var(--foreground)]/60" aria-hidden />
          <span>Memory</span>
          <span className="ml-auto text-xs text-[var(--foreground)]/65">{p.temporary ? "Off in temporary chats" : p.memoryOn ? "On" : "Off"}</span>
          <span aria-hidden className={`relative h-4 w-7 shrink-0 rounded-full transition ${!p.temporary && p.memoryOn ? "bg-emerald-500" : "bg-[var(--glass-border-strong)]"}`}>
            <span className={`absolute top-0.5 size-3 rounded-full bg-white shadow transition-all ${!p.temporary && p.memoryOn ? "left-3.5" : "left-0.5"}`} />
          </span>
        </button>
      </Section>

      <Section title="Context">
        <button type="button" className={ROW} onClick={() => open("context")}>
          <Gauge size={14} className="shrink-0 text-[var(--foreground)]/60" aria-hidden />
          <span className="shrink-0">Context used</span>
          <span className="ml-auto text-xs tabular-nums text-[var(--foreground)]/65">{pct == null ? "—" : `${pct}%`}</span>
          <span aria-hidden className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--glass-bg-strong)]">
            <span className={`block h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
          </span>
        </button>
      </Section>

      <Section title="Connectors">
        <button type="button" className={ROW} onClick={() => open("connectors")}>
          <Plug size={14} className="shrink-0 text-[var(--foreground)]/60" aria-hidden />
          <span>{servers.loading && !servers.data ? "Checking…" : `${connected} connected`}</span>
          {failing && <span aria-label="A connector has an error" title="A connector has an error" className="size-2 shrink-0 rounded-full bg-amber-400" />}
        </button>
      </Section>

      <Section title="Outputs">
        {artifacts.loading && !artifacts.data && <p className="px-3 py-1.5 text-xs text-[var(--foreground)]/60">Loading…</p>}
        {artifacts.data && outputs.length === 0 && <p className="px-3 py-1.5 text-xs text-[var(--foreground)]/60">Nothing created yet</p>}
        {outputs.slice(0, RECENT_OUTPUTS).map((a) => (
          <button key={a.id} type="button" className={ROW} onClick={() => open("outputs", a.id)}>
            <FileCode size={14} className="shrink-0 text-[var(--foreground)]/60" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{a.title}</span>
            <span className="shrink-0 text-[10px] uppercase text-[var(--foreground)]/50">{a.type}</span>
          </button>
        ))}
        {outputs.length > RECENT_OUTPUTS && (
          <button type="button" className={`${ROW} text-xs text-[var(--foreground)]/70`} onClick={() => open("outputs")}>
            Show all ({outputs.length})
          </button>
        )}
      </Section>

      <Section title="Background tasks">
        {active.length === 0 && <p className="px-3 py-1.5 text-xs text-[var(--foreground)]/60">Nothing running</p>}
        {active.map((t) => {
          const time = elapsed(t, now);
          const item = t.kind === "helper" ? t.childId : t.kind === "queued" ? t.id : undefined;
          return (
            <div key={t.id} data-task-kind={t.kind} className="flex items-center gap-1">
              <button type="button" className={`${ROW} min-w-0 flex-1`} onClick={() => open("tasks", item)}>
                <ListChecks size={14} className="shrink-0 text-[var(--foreground)]/60" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-[var(--foreground)]/60">{t.status === "queued" ? "Queued" : time}</span>
              </button>
              {t.kind === "reply" && <IconAction label="Stop reply" onClick={p.onStopReply}><Square size={12} aria-hidden /></IconAction>}
              {t.kind === "helper" && <IconAction label="Stop reply" onClick={p.onStopReply}><Square size={12} aria-hidden /></IconAction>}
              {t.kind === "queued" && <IconAction label="Remove queued message" onClick={() => p.onRemoveQueued(t.id)}><X size={12} aria-hidden /></IconAction>}
              {t.kind === "agent" && <IconAction label="Stop agent talk" onClick={p.onStopAgents}><Square size={12} aria-hidden /></IconAction>}
            </div>
          );
        })}
        {finished > 0 && (
          <button type="button" className={`${ROW} text-xs text-[var(--foreground)]/70`} onClick={() => open("tasks")}>
            {finished} finished
          </button>
        )}
      </Section>

      {p.todosOpen > 0 && (
        <Section title="Todos">
          <button type="button" className={ROW} onClick={() => open("todos")}>
            <ListTodo size={14} className="shrink-0 text-[var(--foreground)]/60" aria-hidden />
            <span>{p.todosOpen} open</span>
          </button>
        </Section>
      )}
    </div>
  );
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="focus-ring mr-1 flex size-7 shrink-0 items-center justify-center rounded-full glass-button text-[var(--foreground)]">
      {children}
    </button>
  );
}
