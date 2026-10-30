"use client";

import { Suspense, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import Sidebar from "@/app/components/Sidebar";
import { SidebarProvider, useSidebar } from "@/app/contexts/SidebarContext";
import { ChatModeProvider } from "@/app/contexts/ChatModeContext";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Columns2, X } from "lucide-react";
import { useCommandPaletteActions } from "@/app/components/CommandPalette";
import { createConversation } from "@/app/hooks/useConversationsApi";
import { clampWidths, dividersPx, resizeDivider, sideShares, SPLIT_MIN_PX } from "@/lib/splitPanes";
import { SplitViewProvider, useSplitView } from "./SplitViewContext";
import { useSearchParams } from "next/navigation";
import { useConversationPage } from "./[id]/useConversationPage";
import ConversationPane from "./[id]/ConversationPane";
import PaneErrorBoundary from "./PaneErrorBoundary";
import DropOverlay from "./DropOverlay";

const SIDEBAR_WIDTH = 256;
const widthKey = (n: number) => `vas:split:widths:${n}`;

function LayoutInner({ children }: { children: ReactNode }) {
  const { isOpen, close, collapsed, toggleCollapsed } = useSidebar();

  return (
    <div className="relative flex h-screen bg-[var(--background)]">
      {/* Mobile sidebar: fixed overlay */}
      <AnimatePresence>
        {isOpen && (
          <div className="md:hidden fixed inset-0 z-40">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={close}
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring" as const, stiffness: 300, damping: 30 }}
              className="relative w-72 max-w-[80vw] h-full glass-panel-strong"
            >
              <Sidebar />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
      {/* Desktop sidebar */}
      <motion.div
        className="hidden md:flex overflow-hidden shrink-0"
        animate={{ width: collapsed ? 0 : SIDEBAR_WIDTH }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
      >
        <Sidebar />
      </motion.div>

      {/* Desktop collapse/expand handle */}
      <motion.button
        onClick={toggleCollapsed}
        animate={{ left: collapsed ? 8 : SIDEBAR_WIDTH - 12 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="hidden md:flex items-center justify-center absolute top-1/2 -translate-y-1/2 z-30 size-6 rounded-full glass-button text-zinc-400 hover:text-zinc-100 transition-colors"
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </motion.button>

      <div className="flex-1 flex flex-col min-w-0">
        <SplitPaletteActions />
        <PaneArea>{children}</PaneArea>
      </div>
    </div>
  );
}

/** Split view entries in the command palette. Actions read the latest state through a ref, since the palette keeps the first ones. */
function SplitPaletteActions() {
  const split = useSplitView();
  const latest = useRef(split);
  useEffect(() => {
    latest.current = split;
  });
  useCommandPaletteActions("Split view", [
    {
      id: "split-new-chat",
      label: "New chat in split view",
      icon: <Columns2 size={16} />,
      onSelect: () => {
        createConversation()
          .then((conv) => latest.current.openSplit(conv.id))
          .catch((error) => console.error("Failed to create conversation:", error));
      },
    },
    { id: "split-close", label: "Close focused pane", icon: <X size={16} />, onSelect: () => latest.current.closeChat(latest.current.focus) },
    { id: "split-next", label: "Focus next pane", icon: <ChevronRight size={16} />, onSelect: () => latest.current.cycleFocus(1) },
    { id: "split-prev", label: "Focus previous pane", icon: <ChevronLeft size={16} />, onSelect: () => latest.current.cycleFocus(-1) },
  ]);
  return null;
}

/**
 * The panes row. The first pane is always today's page (children), so its tree never changes shape
 * when panes open or close. Extra panes render PaneSlot.
 */
function PaneArea({ children }: { children: ReactNode }) {
  const split = useSplitView();
  const { ids, focus, multi, sideBySide, info, limit } = split;
  const page = useConversationPage();
  const initialPrompt = useSearchParams().get("q") ?? undefined;
  const n = ids.length;
  const rowRef = useRef<HTMLDivElement>(null);
  const [stored, setStored] = useState<Record<number, number[]>>({});
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // Side chats that are wide (half the row). Compact is the default.
  const [wideSides, setWideSides] = useState<Record<string, boolean>>({});
  const area = Math.max(0, split.rowWidth - dividersPx(n));
  const sides = ids.map((id) => split.chatPanes.some((x) => x.id === id && x.kind === "side"));
  const wide = ids.map((id) => !!wideSides[id]);
  const shares = n > 1 ? clampWidths(stored[n] ?? sideShares(sides, wide, area), area) : [1];
  const drag = useRef<{ i: number; x: number; start: number[]; cur: number[]; area: number } | null>(null);
  const sized = multi && sideBySide;
  const titleOf = (id: string) => info[id]?.title ?? "Chat";

  const { setRowWidth } = split;
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const sync = () => setRowWidth(el.clientWidth);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [setRowWidth]);

  useEffect(() => {
    const next: Record<number, number[]> = {};
    for (const count of [2, 3]) {
      try {
        const value: unknown = JSON.parse(localStorage.getItem(widthKey(count)) ?? "null");
        if (Array.isArray(value) && value.length === count && value.every((x) => typeof x === "number" && x > 0)) {
          next[count] = value;
        }
      } catch {
        // Widths are a convenience; the equal split is the fallback.
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads localStorage after mount (SSR-safe)
    setStored(next);
  }, []);

  function saveShares(count: number, next: number[]) {
    setStored((prev) => ({ ...prev, [count]: next }));
    try {
      localStorage.setItem(widthKey(count), JSON.stringify(next));
    } catch {
      // Not remembered in this browser; still applied.
    }
  }

  function onDividerDown(i: number, e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { i, x: e.clientX, start: shares, cur: shares, area };
  }

  function onDividerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    d.cur = resizeDivider(d.start, d.i, e.clientX - d.x, d.area);
    setStored((prev) => ({ ...prev, [n]: d.cur }));
  }

  function onDividerUp() {
    const d = drag.current;
    drag.current = null;
    if (d) saveShares(n, d.cur);
  }

  function onDividerKey(i: number, e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = (e.shiftKey ? 64 : 16) * (e.key === "ArrowLeft" ? -1 : 1);
    saveShares(n, resizeDivider(shares, i, step, area));
  }

  /** Flips a side chat between compact and wide. Its width is written like a drag, so the divider still moves it. */
  function toggleSideWide(id: string) {
    setWideSides((prev) => ({ ...prev, [id]: !prev[id] }));
    saveShares(n, sideShares(sides, ids.map((x) => (x === id ? !wideSides[x] : !!wideSides[x])), area));
  }

  function equalize(i: number) {
    const next = [...shares];
    next[i] = next[i + 1] = (shares[i] + shares[i + 1]) / 2;
    saveShares(n, next);
  }

  function renderPane(key: string, id: string | undefined, index: number, body: ReactNode) {
    const visible = !multi || sideBySide || id === focus;
    return (
      <section
        key={key}
        role={multi ? "region" : undefined}
        aria-label={multi && id ? titleOf(id) : undefined}
        data-pane-id={id}
        data-focused={id && id === focus ? "true" : undefined}
        onPointerDownCapture={() => id && split.focusPane(id)}
        onFocusCapture={() => id && split.focusPane(id)}
        className={`@container relative min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--background)] ${visible ? "flex" : "hidden"}`}
        style={sized ? { flex: `${shares[index]} 1 0px`, minWidth: SPLIT_MIN_PX } : undefined}
      >
        {body}
      </section>
    );
  }

  function divider(j: number) {
    return (
      <div
        key={`divider-${j}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${titleOf(ids[j])} and ${titleOf(ids[j + 1])}`}
        aria-valuenow={Math.round(shares[j] * 100)}
        tabIndex={0}
        onPointerDown={(e) => onDividerDown(j, e)}
        onPointerMove={onDividerMove}
        onPointerUp={onDividerUp}
        onPointerCancel={onDividerUp}
        onDoubleClick={() => equalize(j)}
        onKeyDown={(e) => onDividerKey(j, e)}
        className={`group relative z-10 w-1.5 shrink-0 cursor-col-resize touch-none ${sized ? "" : "hidden"}`}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--glass-border)] group-hover:w-0.5 group-hover:bg-[var(--glass-accent)]"
        />
      </div>
    );
  }

  const rows = ids.flatMap((id, i) => [
    ...(i > 0 ? [divider(i - 1)] : []),
    renderPane(id, id, i, (
      <PaneErrorBoundary onClose={() => split.closeChat(id)}>
        <ConversationPane
          conversationId={id}
          focused={id === focus}
          initialPrompt={i === 0 ? initialPrompt : undefined}
          searchProvider={page.searchProvider}
          onToggleSearchProvider={page.toggleSearchProvider}
          sideWide={!!wideSides[id]}
          onToggleSideWide={() => toggleSideWide(id)}
        />
      </PaneErrorBoundary>
    )),
  ]);

  const focusIndex = ids.indexOf(focus);
  const dragEnabled = n >= 1 && sideBySide && limit >= 2;
  const switcher = multi && !sideBySide ? (
    <div className="glass-nav relative z-20 flex h-10 shrink-0 items-center px-3">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={switcherOpen}
        aria-label={`Switch chat, ${focusIndex + 1} of ${n}: ${titleOf(focus)}`}
        onClick={() => setSwitcherOpen((v) => !v)}
        className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--foreground)]"
      >
        <span className="truncate">{titleOf(focus)}</span>
        <span className="shrink-0 rounded px-1.5 text-[10px] font-semibold text-zinc-300 glass-button">
          {focusIndex + 1}/{n}
        </span>
        <ChevronDown size={12} className="shrink-0 text-zinc-400" />
      </button>
      {switcherOpen && (
        <div
          role="menu"
          className="absolute left-3 top-full z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-[var(--glass-radius-md)] border border-[var(--glass-border)] glass-panel-strong p-1 shadow-lg"
        >
          {ids.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitemradio"
              aria-checked={id === focus}
              onClick={() => { split.focusPane(id); setSwitcherOpen(false); }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)]"
            >
              <span className="min-w-0 flex-1 truncate">{titleOf(id)}</span>
              {id === focus && <Check size={12} />}
            </button>
          ))}
          <div className="my-1 border-t border-[var(--glass-border)]" />
          <button
            type="button"
            role="menuitem"
            onClick={() => { setSwitcherOpen(false); split.closeChat(focus); }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-red-500 hover:bg-[var(--glass-bg-hover)]"
          >
            <X size={12} />
            Close this pane
          </button>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {switcher}
      <div
        ref={rowRef}
        role={multi ? "group" : undefined}
        aria-label={multi ? "Split view" : undefined}
        className="relative flex min-h-0 min-w-0 flex-1"
      >
        {ids.length ? rows : renderPane("none", undefined, 0, children)}
        {dragEnabled && split.dragId && (
          <DropOverlay
            rowRef={rowRef}
            ids={ids}
            dragId={split.dragId}
            limit={limit}
            titleOf={titleOf}
            isBusy={split.isBusy}
            onDrop={(zone, chatId) => {
              split.endDrag();
              if (zone.kind === "focus") split.focusPane(chatId);
              else if (zone.kind === "insert") split.insertAt(chatId, zone.index, zone.side);
              else if (zone.kind === "replace") split.replaceAt(zone.paneId, chatId);
            }}
          />
        )}
      </div>
    </div>
  );
}

export default function ConversationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <SidebarProvider>
      {/* SplitViewProvider reads the URL with useSearchParams, which needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <SplitViewProvider>
          {/* Inside SplitViewProvider: the sidebar's mode is the focused pane's. */}
          <ChatModeProvider>
            <LayoutInner>{children}</LayoutInner>
          </ChatModeProvider>
        </SplitViewProvider>
      </Suspense>
    </SidebarProvider>
  );
}
