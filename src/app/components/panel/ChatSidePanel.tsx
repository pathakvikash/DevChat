"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import type { PanelView } from "@/lib/chatPanel";
import { PanelDockContext } from "./PanelDockContext";
import { VIEW_META, availableViews } from "./panelViews";

const WIDTH_KEY = "vas:panel:width";
export const PANEL_DEFAULT_PX = 420;
export const PANEL_MIN_PX = 320;
/** The pane is wide enough to dock the panel beside the transcript from here; below it the panel is a sheet. */
const DOCK_MIN_PANE_PX = 768;
const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function readWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(n) && n >= PANEL_MIN_PX) return n;
  } catch {
    // The width is a convenience; the default is the fallback.
  }
  return PANEL_DEFAULT_PX;
}

/** Between the minimum and 60% of the pane (the minimum wins in a pane too narrow for both). */
export const clampPanel = (px: number, pane: number) => Math.round(Math.max(PANEL_MIN_PX, Math.min(px, pane * 0.6)));

interface Props {
  view: PanelView;
  hasFiles: boolean;
  onView: (view: PanelView) => void;
  onClose: () => void;
  /** Set by the caller just before the panel opens by itself (an artifact arrived): that open must not take focus. */
  quietOpen?: { current: boolean };
  children: ReactNode;
}

/** The docked right panel of a chat pane: a tablist of views, a resize handle, and a full-pane sheet in a narrow pane. */
export default function ChatSidePanel({ view, hasFiles, onView, onClose, quietOpen, children }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [pane, setPane] = useState(0);
  const [stored, setStored] = useState(PANEL_DEFAULT_PX);
  const drag = useRef<{ x: number; start: number } | null>(null);
  const views = availableViews(hasFiles);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads localStorage after mount (SSR-safe)
    setStored(readWidth());
  }, []);

  // The pane's width decides dock or sheet; the pane is the nearest split section.
  useLayoutEffect(() => {
    const host = ref.current?.closest<HTMLElement>("[data-pane-id]") ?? ref.current?.parentElement;
    if (!host) return;
    const sync = () => setPane(host.clientWidth);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const sheet = pane > 0 && pane < DOCK_MIN_PANE_PX;
  const width = clampPanel(stored, pane || 1280);
  const maxWidth = Math.max(PANEL_MIN_PX, Math.round((pane || 1280) * 0.6));

  const save = useCallback((px: number) => {
    setStored(px);
    try {
      localStorage.setItem(WIDTH_KEY, String(px));
    } catch {
      // Not remembered in this browser; still applied.
    }
  }, []);

  // Focus moves into the panel when it opens and goes back to where it was when it closes.
  useEffect(() => {
    if (quietOpen?.current) return;
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    return () => {
      if (before && document.contains(before)) before.focus();
    };
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !sheet) return;
    // A sheet traps focus: Tab wraps at its ends.
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onTabKey(e: KeyboardEvent<HTMLElement>) {
    const i = views.indexOf(view);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: views.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const v = views[(next + views.length) % views.length];
    onView(v);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`#panel-tab-${v}`)?.focus());
  }

  function onHandleDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, start: width };
  }
  function onHandleMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d) setStored(clampPanel(d.start + (d.x - e.clientX), pane));
  }
  function onHandleUp() {
    if (drag.current) save(width);
    drag.current = null;
  }
  function onHandleKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = (e.shiftKey ? 64 : 16) * (e.key === "ArrowLeft" ? 1 : -1);
    save(clampPanel(width + step, pane || 1280));
  }

  return (
    <aside
      ref={ref}
      aria-label="Chat panel"
      role={sheet ? "dialog" : undefined}
      aria-modal={sheet || undefined}
      data-panel-mode={sheet ? "sheet" : "dock"}
      onKeyDown={onKeyDown}
      style={sheet ? undefined : { width }}
      className={
        sheet
          ? "@container absolute inset-0 z-30 flex flex-col bg-[var(--background)]"
          : "@container relative z-10 flex h-full shrink-0 flex-col border-l border-[var(--glass-border)] bg-[var(--background)]"
      }
    >
      {!sheet && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          aria-valuemin={PANEL_MIN_PX}
          aria-valuemax={maxWidth}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          onDoubleClick={() => save(PANEL_DEFAULT_PX)}
          onKeyDown={onHandleKey}
          className="group absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none"
        >
          <span aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 group-hover:w-0.5 group-hover:bg-[var(--glass-accent)] group-focus-visible:w-0.5 group-focus-visible:bg-[var(--glass-accent)]" />
        </div>
      )}
      <div className="flex items-center gap-1 border-b border-[var(--glass-border)] px-2 py-1.5">
        <div role="tablist" aria-label="Panel views" onKeyDown={onTabKey} className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {views.map((v) => {
            const { label, icon: Icon } = VIEW_META[v];
            const on = v === view;
            return (
              <button
                key={v}
                id={`panel-tab-${v}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls="panel-body"
                tabIndex={on ? 0 : -1}
                title={label}
                onClick={() => onView(v)}
                className={`focus-ring flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--glass-radius-md)] px-2 text-xs font-medium ${on ? "glass-strong text-[var(--foreground)]" : "text-[var(--foreground)]/60 hover:bg-[var(--glass-bg-hover)] hover:text-[var(--foreground)]"}`}
              >
                <Icon size={14} aria-hidden />
                <span className={on ? "" : "hidden @min-[30rem]:inline"}>{label}</span>
              </button>
            );
          })}
        </div>
        <button type="button" onClick={onClose} aria-label="Close panel" title="Close panel (Esc)" className="focus-ring flex size-8 shrink-0 items-center justify-center rounded-[var(--glass-radius-md)] glass-button">
          <X size={16} aria-hidden />
        </button>
      </div>
      <div id="panel-body" role="tabpanel" aria-labelledby={`panel-tab-${view}`} className="min-h-0 flex-1 overflow-hidden">
        <PanelDockContext.Provider value={true}>{children}</PanelDockContext.Provider>
      </div>
    </aside>
  );
}
