"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, Maximize2, Minimize2, Plus, X } from "lucide-react";
import { getRelativeTime } from "../MessageActions";
import type { SideChatSummary } from "@/lib/sideChat";
import { isMac } from "@/lib/utils/platform";

interface SideChatHeaderProps {
  /** The tab chip's text: the side chat's title, or its first message. */
  title: string;
  /** Side chats of this main chat, newest first. */
  history: SideChatSummary[];
  activeId: string;
  onSelect: (id: string) => void;
  onNewSideChat: () => void;
  onClose: () => void;
  /** Wide: half the row. Compact: about 400px. */
  expanded: boolean;
  onToggleExpanded: () => void;
}

const iconButton =
  "focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--glass-radius-sm)] text-zinc-400 transition hover:bg-[var(--glass-bg-hover)] hover:text-zinc-200";

export default function SideChatHeader({
  title,
  history,
  activeId,
  onSelect,
  onNewSideChat,
  onClose,
  expanded,
  onToggleExpanded,
}: SideChatHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const shortcut = isMac() ? "⌘\\" : "Ctrl+\\";

  useEffect(() => {
    if (!menuOpen) return;
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const current = menuRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    (current ?? menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]'))?.focus();
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
    triggerRef.current?.focus();
  }

  function select(id: string) {
    closeMenu();
    onSelect(id);
  }

  function handleMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeMenu();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    const next = i < 0 ? (step > 0 ? 0 : items.length - 1) : (i + step + items.length) % items.length;
    items[next].focus();
  }

  return (
    <div className="relative z-20 flex h-12 shrink-0 items-center gap-2 px-3">
      <div className="relative min-w-0">
        <div className="glass-button inline-flex h-8 max-w-[260px] items-center gap-2 rounded-[var(--glass-radius-sm)] px-3 text-sm">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Older side chats"
            className="focus-ring min-w-0 truncate rounded-sm text-left text-[var(--foreground)]"
          >
            {title}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close side chat"
            title="Close side chat"
            className="focus-ring shrink-0 rounded-sm text-zinc-400 transition hover:text-zinc-200"
          >
            <X size={14} />
          </button>
        </div>
        {menuOpen && (
          <div
            ref={menuRef}
            role="menu"
            aria-label="Older side chats"
            onKeyDown={handleMenuKey}
            className="absolute left-0 top-full z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] glass-panel-strong rounded-[var(--glass-radius-md)] border border-[var(--glass-border-strong)] shadow-lg overflow-hidden"
          >
            {history.length === 0 ? (
              <p className="px-4 py-3 text-sm text-zinc-400">No older side chats</p>
            ) : (
              history.map((item) => {
                const current = item.id === activeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    aria-current={current ? "true" : undefined}
                    onClick={() => select(item.id)}
                    className="focus-ring flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[var(--foreground)] transition hover:bg-[var(--glass-bg-hover)]"
                  >
                    {current ? <Check size={14} className="shrink-0" /> : <span className="w-3.5 shrink-0" aria-hidden />}
                    <span className="min-w-0 flex-1 truncate">{item.title || "Side chat"}</span>
                    <span className="shrink-0 text-xs text-zinc-400">{getRelativeTime(item.updatedAt)}</span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button type="button" onClick={onNewSideChat} aria-label="New side chat" title="New side chat" className={iconButton}>
          <Plus size={16} />
        </button>
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-label={expanded ? "Collapse side chat" : "Expand side chat"}
          title={expanded ? "Collapse side chat" : "Expand side chat"}
          className={iconButton}
        >
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button type="button" onClick={onClose} aria-label="Close side chat" title={`Close side chat (${shortcut})`} className={iconButton}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
