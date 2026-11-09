"use client";

import { useState } from "react";
import { Bot, Copy, Check, MessageSquare, Plug, Play, Search, Trash2, X, ChevronDown, ChevronRight } from "lucide-react";
import { CATALOG, isCliModelId, MCP_WEB_WARNING, reachesOpenWeb, type FieldSpec } from "@/lib/workflows/catalog";
import { ancestorsOf, TRIGGER_ID, type CardRun, type FlowNode, type GraphIssue, type RunState, type WorkflowGraph } from "@/lib/workflows/graph";
import ConfigField, { type FieldEnv } from "./ConfigField";
import { cardStatus, formatDuration, formatTokens, StatusBadge } from "./RunStatus";
import { fetchNodeRun } from "./useWorkflowRun";

const CARD_ICONS = { Play, Search, Bot, MessageSquare, Plug } as const;

/** A card type's icon, by the catalog's icon name. */
export function CardIcon({ name, size = 14, className }: { name: string; size?: number; className?: string }) {
  const Icon = CARD_ICONS[name as keyof typeof CARD_ICONS] ?? Play;
  return <Icon size={size} className={className} aria-hidden="true" />;
}

function LastRun({ nodeId, card, runId, runState }: { nodeId: string; card: CardRun | undefined; runId: string | null; runState?: RunState }) {
  const [output, setOutput] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const finished = card?.status === "succeeded" || card?.status === "skipped";

  if (!card) return <p className="text-sm text-zinc-400">This card has not run yet. Press Run.</p>;
  const tokens = card.usage ? card.usage.inputTokens + card.usage.outputTokens : 0;

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <StatusBadge status={cardStatus(card, runState)} />
        {card.startedAt && <span className="font-mono text-xs tabular-nums text-zinc-400">{formatDuration(card.startedAt, card.endedAt)}</span>}
        {tokens > 0 && <span className="font-mono text-xs tabular-nums text-zinc-400">{formatTokens(tokens)} tokens</span>}
      </div>
      {card.error && <p className="text-xs text-zinc-300">{card.error}</p>}
      {card.skippedReason && <p className="text-xs text-zinc-300">Skipped: {card.skippedReason}</p>}
      {!!card.warnings?.length && (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-zinc-300">
          {card.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {!!card.itemErrors?.length && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-zinc-300">Item errors</h4>
          <ul className="space-y-0.5 text-xs text-zinc-300">
            {card.itemErrors.map((e) => (
              <li key={e.index}>
                #{e.index}: {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!card.log?.length && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-zinc-300">Tool steps</h4>
          <ul className="space-y-0.5 font-mono text-[11px] text-zinc-400">
            {card.log.map((s, i) => (
              <li key={i} className="truncate">
                {s.tool} {s.label} · {s.state}
              </li>
            ))}
          </ul>
        </div>
      )}
      {finished && runId && (
        <div>
          <button
            type="button"
            onClick={async () => {
              setOpen((o) => !o);
              if (output === null) {
                const full = await fetchNodeRun(runId, nodeId);
                setOutput(JSON.stringify(full?.output ?? null, null, 2));
              }
            }}
            aria-expanded={open}
            className="focus-ring flex items-center gap-1 text-xs font-medium text-zinc-300"
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Output
          </button>
          {open && (
            <div className="glass-card mt-1 overflow-hidden rounded-[var(--glass-radius-md)]">
              <div className="glass-surface flex items-center justify-between px-3 py-1 text-xs text-zinc-400">
                <span>json</span>
                <button
                  type="button"
                  className="focus-ring flex items-center gap-1 hover:text-zinc-200"
                  onClick={async () => {
                    await navigator.clipboard.writeText(output ?? "");
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <pre className="max-h-72 overflow-auto p-3 text-[11px] text-zinc-300">{output ?? "Loading…"}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ConfigPanel({
  node,
  graph,
  card,
  runId,
  runState,
  issues,
  env,
  onChange,
  onDelete,
  onClose,
  overlay,
}: {
  node: FlowNode;
  graph: WorkflowGraph;
  card: CardRun | undefined;
  runId: string | null;
  runState?: RunState;
  issues: GraphIssue[];
  env: FieldEnv;
  onChange: (patch: Partial<FlowNode>) => void;
  onDelete: () => void;
  onClose: () => void;
  overlay?: boolean;
}) {
  const [tab, setTab] = useState<"settings" | "last">("settings");
  const [advanced, setAdvanced] = useState(false);
  const def = CATALOG[node.type];
  const mine = issues.filter((i) => i.nodeId === node.id && !i.warning);
  const descendants = new Set(graph.nodes.filter((n) => ancestorsOf(graph, n.id).has(node.id)).map((n) => n.id));
  const canRunAfter = graph.nodes.filter((n) => n.id !== node.id && !descendants.has(n.id));
  const visible = (f: FieldSpec) => !f.when || f.when(node.config);
  const setConfig = (key: string, value: unknown) => {
    let config = { ...node.config, [key]: value };
    // A folder only belongs to a command-line model, and edits only to a folder.
    if (key === "model" && !isCliModelId(String(value || graph.defaultModel))) config = { ...config, folder: "", allowEdits: false };
    if (key === "folder" && !value) config = { ...config, allowEdits: false };
    onChange({ config });
  };
  const upstreamWeb = [...ancestorsOf(graph, node.id)].some((a) => {
    const up = graph.nodes.find((n) => n.id === a);
    return !!up && reachesOpenWeb(up.type, up.config, graph.defaultModel);
  });
  const fieldEnv = { ...env, upstreamWeb };

  return (
    <aside aria-label={`${node.ui.label} settings`} className={`flex h-full flex-col ${overlay ? "" : "glass-panel w-[360px] shrink-0 border-l border-[var(--glass-border)]"}`}>
      <header className="flex items-start gap-2 border-b border-[var(--glass-border)] px-4 py-3">
        <span className="glass flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--glass-radius-sm)]">
          <CardIcon name={def.icon} className="text-zinc-300" />
        </span>
        <div className="min-w-0 flex-1">
          <input
            aria-label="Card name"
            value={node.ui.label}
            disabled={env.readOnly}
            onChange={(e) => onChange({ ui: { ...node.ui, label: e.target.value } })}
            className="focus-ring glass-input w-full rounded-[var(--glass-radius-sm)] px-2 py-1 text-sm font-medium"
          />
          <p className="mt-0.5 text-xs text-zinc-400">{def.label}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close settings" title="Close (Esc)" className="focus-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--glass-radius-sm)] text-zinc-400 hover:bg-[var(--glass-bg-hover)] hover:text-[var(--foreground)]">
          <X size={16} />
        </button>
      </header>

      <div role="tablist" aria-label="Card panel" className="mx-4 mt-3 flex rounded-[var(--glass-radius-md)] glass-button p-0.5 text-xs">
        {(["settings", "last"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`focus-ring h-7 flex-1 rounded-[calc(var(--glass-radius-md)-2px)] font-medium ${tab === t ? "glass-button-primary text-white" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            {t === "settings" ? "Settings" : "Last run"}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {env.readOnly && (
          <p className="text-xs text-zinc-400">
            {env.readOnlyReason === "past" ? "This is a past run, so its cards are read-only." : "Edit cards on a wider screen. This view is read-only."}
          </p>
        )}
        {tab === "settings" ? (
          <>
            <p className="text-xs text-zinc-400">{def.description}</p>
            {def.fields.filter(visible).map((spec) => (
              <ConfigField key={spec.key} spec={spec} config={node.config} onChange={setConfig} env={fieldEnv} error={mine.find((i) => i.field === spec.key)?.message.replace(/^[^:]*: /, "")} />
            ))}
            {node.type === "mcpTool" && (upstreamWeb || reachesOpenWeb(node.type, node.config)) && <p className="text-xs text-zinc-300">{MCP_WEB_WARNING}</p>}
            {def.fields.length === 0 && <p className="text-sm text-zinc-400">Nothing to set. This card starts the flow.</p>}
            {node.type !== "trigger" && (
              <div className="border-t border-[var(--glass-border)] pt-3">
                <button type="button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced} className="focus-ring flex items-center gap-1 text-xs font-medium text-zinc-300">
                  {advanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Advanced
                </button>
                {advanced && (
                  <div className="mt-2 space-y-3 text-xs text-zinc-300">
                    <p>
                      Card id <span className="font-mono">{node.id}</span>
                    </p>
                    <fieldset>
                      <legend className="mb-1 font-medium">Runs after</legend>
                      {canRunAfter.map((n) => (
                        <label key={n.id} className="flex items-center gap-2 py-0.5">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            disabled={env.readOnly}
                            checked={node.fromIds.includes(n.id)}
                            onChange={(e) => onChange({ fromIds: e.target.checked ? [...node.fromIds, n.id] : node.fromIds.filter((f) => f !== n.id) })}
                          />
                          {n.ui.label}
                        </label>
                      ))}
                    </fieldset>
                    {CATALOG[node.type].perItem && node.config.perItem === true && (
                      <label className="flex items-center gap-2">
                        Max items
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={Number(node.config.maxItems ?? 25)}
                          disabled={env.readOnly}
                          onChange={(e) => setConfig("maxItems", Math.max(1, Math.min(100, Number(e.target.value) || 25)))}
                          className="focus-ring glass-input w-20 rounded-[var(--glass-radius-sm)] px-2 py-1"
                        />
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}
            {node.id !== TRIGGER_ID && !env.readOnly && (
              <button type="button" onClick={onDelete} className="focus-ring glass-button-danger inline-flex h-8 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-3 text-sm">
                <Trash2 size={14} aria-hidden="true" /> Delete card
              </button>
            )}
          </>
        ) : (
          <LastRun key={`${runId}:${node.id}`} nodeId={node.id} card={card} runId={runId} runState={runState} />
        )}
      </div>
    </aside>
  );
}
