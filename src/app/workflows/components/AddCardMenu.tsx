"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ADDABLE_TYPES, CATALOG, type CardType } from "@/lib/workflows/catalog";
import { CardIcon } from "./ConfigPanel";

/** The catalog popover (8.4): grouped by category, type to filter, ↑↓ to move, Enter to add, Esc to close. */
export default function AddCardMenu({ onPick, onClose }: { onPick: (type: CardType) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    const outside = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc, true);
    };
  }, [onClose]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = ADDABLE_TYPES.filter((t) => !q || `${CATALOG[t].label} ${CATALOG[t].description} ${CATALOG[t].category}`.toLowerCase().includes(q));
    const categories = [...new Set(ADDABLE_TYPES.map((t) => CATALOG[t].category))];
    return categories.map((c) => ({ category: c, types: shown.filter((t) => CATALOG[t].category === c) })).filter((g) => g.types.length > 0);
  }, [query]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>("input, button") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  }

  return (
    <div ref={wrap} role="dialog" aria-label="Add card" onKeyDown={onKeyDown} className="glass-panel-strong z-50 w-72 rounded-[var(--glass-radius-md)] p-2 shadow-lg">
      <input
        ref={input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && groups[0] && (e.preventDefault(), onPick(groups[0].types[0]))}
        placeholder="Filter cards…"
        aria-label="Filter cards"
        className="focus-ring glass-input mb-1 w-full rounded-[var(--glass-radius-sm)] px-2 py-1 text-sm"
      />
      <div className="max-h-72 overflow-y-auto">
        {groups.map((g) => (
          <section key={g.category} aria-label={g.category}>
            <h3 className="px-2 pt-1.5 text-[11px] font-medium text-zinc-400">{g.category}</h3>
            <ul>
              {g.types.map((t) => (
                <li key={t}>
                  <button type="button" onClick={() => onPick(t)} className="focus-ring flex w-full items-start gap-3 rounded-[var(--glass-radius-sm)] px-2 py-1.5 text-left hover:bg-[var(--glass-bg-hover)]">
                    <CardIcon name={CATALOG[t].icon} className="mt-0.5 shrink-0 text-zinc-300" />
                    <span>
                      <span className="block text-sm text-zinc-200">{CATALOG[t].label}</span>
                      <span className="block text-xs text-zinc-400">{CATALOG[t].description}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {groups.length === 0 && <p className="px-2 py-1 text-xs text-zinc-400">No cards match.</p>}
      </div>
    </div>
  );
}
