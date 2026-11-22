"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { PanelRight, Columns2 } from "lucide-react";
import type { PanelView } from "@/lib/chatPanel";
import { VIEW_META, VIEW_ORDER } from "@/app/components/panel/panelViews";

interface Props {
  /** Undefined hides the Side chat entry (sub-agent transcripts, no split view). */
  onToggleSide?: () => void;
  sideOpen: boolean;
  /** Files needs host tools and a working folder. */
  hasFiles: boolean;
  runningTasks: number;
  /** The view the panel shows now, if it is open. */
  activeView: PanelView | null;
  onOpenView: (view: PanelView) => void;
}

/** Option+digit that opens each launcher entry; Side chat is 1, so a hidden Files leaves a gap rather than renumbering. */
export const VIEW_KEYS: Record<PanelView, string> = Object.fromEntries(VIEW_ORDER.map((v, i) => [v, `⌥${i + 2}`])) as Record<PanelView, string>;

/** The header's Panel button and its launcher menu: side chat and the panel's views. */
export default function PanelLauncher({ onToggleSide, sideOpen, hasFiles, runningTasks, activeView, onOpenView }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
      return;
    }
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (next === undefined) {
      if (e.key === "Tab") setOpen(false);
      return;
    }
    e.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  }

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const views = VIEW_ORDER.filter((v) => v !== "files" || hasFiles);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Panel"
        title="Panel (⌥P)"
        onClick={() => setOpen((v) => !v)}
        className={`focus-ring flex size-8 shrink-0 items-center justify-center rounded-[var(--glass-radius-md)] ${activeView || open ? "glass-strong" : "glass-button"} text-[var(--foreground)]`}
      >
        <PanelRight size={16} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Panel"
          onKeyDown={onMenuKey}
          className="glass-panel-strong absolute right-0 top-full z-[60] mt-1 w-64 max-w-[calc(100vw-1rem)] rounded-[var(--glass-radius-md)] border border-[var(--glass-border-strong)] p-1 shadow-lg"
        >
          {onToggleSide && (
            <Item onClick={pick(onToggleSide)} icon={<Columns2 size={14} aria-hidden />} hint="⌘\" checked={sideOpen}>
              Side chat
            </Item>
          )}
          {views.map((v) => {
            const { label, icon: Icon } = VIEW_META[v];
            return (
              <Item key={v} onClick={pick(() => onOpenView(v))} icon={<Icon size={14} aria-hidden />} hint={VIEW_KEYS[v]} checked={activeView === v} note={v === "tasks" && runningTasks > 0 ? `${runningTasks} running` : undefined}>
                {label}
              </Item>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Item({ children, icon, hint, note, checked, onClick }: { children: string; icon: React.ReactNode; hint: string; note?: string; checked?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={onClick}
      aria-current={checked || undefined}
      className="focus-ring flex w-full items-center gap-2.5 rounded-[var(--glass-radius-sm)] px-3 py-2 text-left text-sm text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)]"
    >
      <span className="shrink-0 text-[var(--foreground)]/65">{icon}</span>
      <span className="flex-1">{children}</span>
      {note && <span className="text-xs text-blue-400">{note}</span>}
      <kbd className="shrink-0 text-[11px] text-[var(--foreground)]/50">{hint}</kbd>
    </button>
  );
}
