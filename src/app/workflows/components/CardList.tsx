"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, Plus } from "lucide-react";
import { ADDABLE_TYPES, CATALOG, type CardType } from "@/lib/workflows/catalog";
import { topoOrder, type CardRun, type FlowNode, type RunState, type WorkflowGraph } from "@/lib/workflows/graph";
import { CardIcon } from "./ConfigPanel";
import { cardStatus, formatTokens, STATUS_META, StatusBadge } from "./RunStatus";

export function footerOf(node: FlowNode, card: CardRun | undefined): string {
  const parts: string[] = [];
  if (CATALOG[node.type].perItem && node.config.perItem === true) parts.push("Each item");
  if (card?.items) parts.push(`${card.items.done}/${card.items.total}`);
  const tokens = card?.usage ? card.usage.inputTokens + card.usage.outputTokens : 0;
  if (tokens > 0) parts.push(`${formatTokens(tokens)} tokens`);
  return parts.join(" · ");
}

/** The cards in run order, one `glass-card` each. The phase-1 editor, the narrow-screen view and the canvas's accessible twin. */
export default function CardList({
  graph,
  nodes,
  runState,
  selectedId,
  invalid,
  readOnly,
  canAdd,
  onSelect,
  onAdd,
}: {
  graph: WorkflowGraph;
  nodes: Record<string, CardRun>;
  runState?: RunState;
  selectedId: string | null;
  /** Card ids with a problem in their settings. */
  invalid: Set<string>;
  readOnly: boolean;
  /** False at the 30-card limit. */
  canAdd: boolean;
  /** Without it the cards are plain, not buttons (a preview). */
  onSelect?: (id: string) => void;
  onAdd: (type: CardType) => void;
}) {
  const [menu, setMenu] = useState(false);
  const wrap = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setMenu(false));
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc, true);
    };
  }, [menu]);

  const order = topoOrder(graph);
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.ui.label ?? id;

  return (
    <ol aria-label="Cards in run order" className="mx-auto flex max-w-xl flex-col items-stretch gap-2 p-4">
      {order.map((node, i) => {
        const def = CATALOG[node.type];
        const card = nodes[node.id];
        const status = cardStatus(card, runState);
        const footer = footerOf(node, card);
        const border =
          status === "failed" ? "border-red-900/50" : status === "waiting" ? "border-amber-900/50" : "";
        const inner = <>
                <div className="flex h-11 items-center gap-2 bg-[var(--glass-bg-elevated)] px-3">
                  <span className="glass flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--glass-radius-sm)]">
                    <CardIcon name={def.icon} className="text-zinc-300" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200">{node.ui.label}</span>
                  <StatusBadge status={status} />
                </div>
                <div className="px-3 py-2 text-xs text-zinc-400">
                  <span className="line-clamp-2">
                    {def.label} · {def.summary(node.config)}
                  </span>
                  {node.fromIds.length > 1 && <span className="mt-0.5 block">after: {node.fromIds.map(label).join(", ")}</span>}
                  {invalid.has(node.id) && <span className="mt-0.5 block text-zinc-300">Needs attention: open the card to see what is missing.</span>}
                  {card?.error && <span className="mt-0.5 line-clamp-2 text-zinc-300">{card.error}</span>}
                  {card?.skippedReason && <span className="mt-0.5 line-clamp-2">{card.skippedReason}</span>}
                </div>
                {footer && <div className="border-t border-[var(--glass-border)] px-3 py-1.5 font-mono text-[11px] tabular-nums text-zinc-400">{footer}</div>}
              </>;
        return (
          <li key={node.id} className="flex flex-col items-stretch gap-2">
            <div
              role="group"
              aria-label={`${node.ui.label}, ${def.label}, ${STATUS_META[status].label}`}
              className={`glass-card overflow-hidden rounded-[var(--glass-radius-md)] border ${border || "border-transparent"} ${selectedId === node.id ? "ring-2 ring-[var(--glass-accent-strong)]" : ""}`}
            >
              {onSelect ? (
                <button type="button" onClick={() => onSelect(node.id)} aria-label={`Open settings for ${node.ui.label}`} className="focus-ring block w-full text-left">
                  {inner}
                </button>
              ) : (
                <div>{inner}</div>
              )}
            </div>
            {i < order.length - 1 && <ArrowDown size={14} className="mx-auto text-zinc-500" aria-hidden="true" />}
          </li>
        );
      })}
      {!readOnly && canAdd && (
        <li ref={wrap} className="relative mt-2 flex justify-center">
          <button type="button" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} className="focus-ring glass-button inline-flex h-8 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-3 text-sm font-medium">
            <Plus size={14} aria-hidden="true" /> Add card
          </button>
          {menu && (
            <ul role="menu" className="glass-panel-strong absolute top-full z-50 mt-1 w-64 rounded-[var(--glass-radius-md)] p-1 shadow-lg">
              {ADDABLE_TYPES.map((t) => {
                return (
                  <li key={t} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenu(false);
                        onAdd(t);
                      }}
                      className="focus-ring flex w-full items-start gap-3 rounded-[var(--glass-radius-sm)] px-3 py-2 text-left hover:bg-[var(--glass-bg-hover)]"
                    >
                      <CardIcon name={CATALOG[t].icon} className="mt-0.5 shrink-0 text-zinc-300" />
                      <span>
                        <span className="block text-sm text-zinc-200">{CATALOG[t].label}</span>
                        <span className="block text-xs text-zinc-400">{CATALOG[t].description}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      )}
    </ol>
  );
}
