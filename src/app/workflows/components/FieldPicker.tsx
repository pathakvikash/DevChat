"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CATALOG } from "@/lib/workflows/catalog";
import { ancestorsOf, topoOrder, type FlowNode, type WorkflowGraph } from "@/lib/workflows/graph";

export interface PickerRow {
  group: string;
  path: string;
  sample: string;
}

const sampleOf = (v: unknown): string => {
  if (v === undefined) return "";
  const t = typeof v === "string" ? v : JSON.stringify(v);
  return (t ?? "").replace(/\s+/g, " ").slice(0, 40);
};

/** The fields a card can insert, in the order of 5.2: this item, each earlier card, variables, run. */
export function pickerRows(opts: {
  graph: WorkflowGraph;
  node: FlowNode;
  perItem: boolean;
  /** Latest outputs by card id (from the run being shown). */
  outputs: Record<string, unknown>;
  /** The first element of the Items list, as a sample item. */
  sampleItem?: unknown;
}): PickerRow[] {
  const { graph, node, outputs } = opts;
  const rows: PickerRow[] = [];
  if (opts.perItem) {
    rows.push({ group: "This item", path: "item", sample: sampleOf(opts.sampleItem) });
    if (opts.sampleItem && typeof opts.sampleItem === "object" && !Array.isArray(opts.sampleItem)) {
      for (const [k, v] of Object.entries(opts.sampleItem)) rows.push({ group: "This item", path: `item.${k}`, sample: sampleOf(v) });
    }
    rows.push({ group: "This item", path: "index", sample: "1" });
  }
  const ancestors = ancestorsOf(graph, node.id);
  for (const other of topoOrder(graph)) {
    if (!ancestors.has(other.id)) continue;
    const out = outputs[other.id];
    const seen = out && typeof out === "object" && !Array.isArray(out) ? Object.keys(out) : [];
    const keys = [...new Set([...CATALOG[other.type].outputs(other.config), ...seen])];
    for (const k of keys) rows.push({ group: other.ui.label, path: `${other.id}.${k}`, sample: sampleOf((out as Record<string, unknown> | undefined)?.[k]) });
  }
  for (const v of graph.vars) rows.push({ group: "Variables", path: `vars.${v.key}`, sample: sampleOf(v.value) });
  rows.push(
    { group: "Run", path: "run.date", sample: "" },
    { group: "Run", path: "run.startedAt", sample: "" },
    { group: "Run", path: "workflow.name", sample: "" },
  );
  return rows;
}

/** True when the two characters before the caret are `{{`: the cue to open the picker. */
export const typedBraces = (value: string, caret: number | null): boolean => caret !== null && caret >= 2 && value.slice(caret - 2, caret) === "{{";

/** A small popover: type to filter, ↑↓ to move, Enter to insert, Esc to close (the slash-menu pattern). */
export default function FieldPicker({
  rows,
  onPick,
  onClose,
}: {
  rows: PickerRow[];
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.path.toLowerCase().includes(q) || r.group.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  const hasCardFields = rows.some((r) => !["This item", "Variables", "Run"].includes(r.group));

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, Math.min(shown.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter" && shown[active]) {
      e.preventDefault();
      onPick(shown[active].path);
    }
  }

  return (
    <div role="dialog" aria-label="Insert field" onKeyDown={onKeyDown} className="glass-panel-strong absolute z-50 mt-1 w-full max-w-sm rounded-[var(--glass-radius-md)] p-2 shadow-lg">
      <input
        ref={input}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        placeholder="Filter fields…"
        aria-label="Filter fields"
        className="focus-ring glass-input mb-1 w-full rounded-[var(--glass-radius-sm)] px-2 py-1 text-sm"
      />
      <p className="px-1 pb-1 text-[11px] text-zinc-400">↑↓ to move, Enter to insert, Esc to close</p>
      {!hasCardFields && <p className="px-1 pb-1 text-[11px] text-zinc-400">Nothing to insert yet. Connect a card before this one.</p>}
      <ul role="listbox" className="max-h-60 overflow-y-auto">
        {shown.map((r, i) => {
          const heading = i === 0 || shown[i - 1].group !== r.group ? r.group : null;
          return (
            <li key={r.path} role="presentation">
              {heading && <div className="px-1 pt-1 text-[11px] font-medium text-zinc-400">{heading}</div>}
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(r.path)}
                className={`focus-ring flex w-full items-center justify-between gap-2 rounded-[var(--glass-radius-sm)] px-2 py-1 text-left text-xs ${i === active ? "bg-[var(--glass-bg-hover)]" : ""}`}
              >
                <span className="font-mono text-zinc-200">{r.path}</span>
                <span className="truncate text-zinc-400">{r.sample}</span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-2 py-1 text-xs text-zinc-400">No fields match.</li>}
      </ul>
    </div>
  );
}
