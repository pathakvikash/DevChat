"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { CATALOG } from "@/lib/workflows/catalog";
import { TRIGGER_ID, type CardRun, type FlowNode, type RunState } from "@/lib/workflows/graph";
import { footerOf } from "./CardList";
import { CardIcon } from "./ConfigPanel";
import { cardStatus, StatusBadge } from "./RunStatus";

export type CardData = {
  node: FlowNode;
  card?: CardRun;
  runState?: RunState;
  /** The card has a problem in its settings. */
  invalid: boolean;
  readOnly: boolean;
  /** Called by the "Open settings" button; React Flow's own click also selects. */
  onOpen: (id: string) => void;
} & Record<string, unknown>;
export type CardFlowNode = Node<CardData, "card">;

/**
 * A card on the canvas (8.3). The React Flow wrapper around it is the focusable group (its aria-label carries the status word);
 * the button inside is for the pointer and screen-reader browse mode, so Tab visits each card once.
 */
function CardNode({ data, selected }: NodeProps<CardFlowNode>) {
  const { node, card, runState, invalid, readOnly } = data;
  const def = CATALOG[node.type];
  const status = cardStatus(card, runState);
  const footer = footerOf(node, card);
  const border = status === "failed" ? "border-red-900/50" : status === "waiting" ? "border-amber-900/50" : "border-transparent";

  return (
    <div className="relative w-60">
      {node.id !== TRIGGER_ID && <Handle type="target" position={Position.Left} isConnectable={!readOnly} className="flow-handle" />}
      <div data-selected={selected || undefined} className={`flow-card glass-card overflow-hidden rounded-[var(--glass-radius-md)] border ${border}`}>
        <button type="button" tabIndex={-1} onClick={() => data.onOpen(node.id)} aria-label={`Open settings for ${node.ui.label}`} className="block w-full cursor-pointer text-left">
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
            {invalid && <span className="mt-0.5 block text-zinc-300">Needs attention</span>}
            {card?.error && <span className="mt-0.5 line-clamp-2 text-zinc-300">{card.error}</span>}
            {card?.skippedReason && <span className="mt-0.5 line-clamp-2">{card.skippedReason}</span>}
          </div>
          {footer && <div className="border-t border-[var(--glass-border)] px-3 py-1.5 font-mono text-[11px] tabular-nums text-zinc-400">{footer}</div>}
        </button>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={!readOnly} className="flow-handle" />
    </div>
  );
}

export default memo(CardNode);
