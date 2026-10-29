"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Check, History, MessageSquare, PanelLeft, PanelRight, SquarePen, X } from "lucide-react";
import ModelSelector from "../conversation/ModelSelector";
import { getRelativeTime } from "../MessageActions";
import type { SideChatSummary } from "@/lib/sideChat";
import { isMac } from "@/lib/utils/platform";

interface SideChatHeaderProps {
  title: string;
  parentId: string;
  parentTitle: string;
  model: string;
  onModelChange: (modelId: string) => void;
  modelDisabled?: boolean;
  /** Side chats of this main chat, newest first. */
  history: SideChatSummary[];
  activeId: string;
  onSelect: (id: string) => void;
  onNewSideChat: () => void;
  dock: "left" | "right";
  onToggleDock: () => void;
  onClose: () => void;
  /** Lets the pane focus the main chat instead of navigating to it. */
  onOpenParent?: () => void;
  /** Main-chat messages this side chat sees, and how many the main chat has. */
  shown?: number;
  total?: number;
}

const iconButton =
  "focus-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--glass-radius-md)] glass-button text-[var(--foreground)] transition";

export default function SideChatHeader({
  title,
  parentId,
  parentTitle,
  model,
  onModelChange,
  modelDisabled = false,
  history,
  activeId,
  onSelect,
  onNewSideChat,
  dock,
  onToggleDock,
  onClose,
  onOpenParent,
  shown,
  total,
}: SideChatHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const shortcut = isMac() ? "⌘\\" : "Ctrl+\\";
  const trimmed = shown !== undefined && total !== undefined && shown < total;
  const modelName = model.split("/").pop();
  const dockTarget = dock === "right" ? "left" : "right";
  const DockIcon = dockTarget === "left" ? PanelLeft : PanelRight;

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

  function openParent(e: ReactMouseEvent<HTMLAnchorElement>) {
    if (!onOpenParent) return;
    e.preventDefault();
    onOpenParent();
  }

  return (
    <div className="glass-nav relative z-20 px-3 py-2">
      <div className="flex h-8 items-center gap-1">
        <h2 title={title} className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--foreground)]">
          {title || "Side chat"}
        </h2>

        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Older side chats"
            title="Older side chats"
            className={iconButton}
          >
            <History size={16} />
          </button>
          {menuOpen && (
            <div
              ref={menuRef}
              role="menu"
              aria-label="Older side chats"
              onKeyDown={handleMenuKey}
              className="absolute right-0 top-full z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] glass-panel-strong rounded-[var(--glass-radius-md)] border border-[var(--glass-border-strong)] shadow-lg overflow-hidden"
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

        <button type="button" onClick={onNewSideChat} aria-label="New side chat" title="New side chat" className={iconButton}>
          <SquarePen size={16} />
        </button>
        <button
          type="button"
          onClick={onToggleDock}
          aria-label={`Dock ${dockTarget}`}
          title={`Dock ${dockTarget}`}
          className={iconButton}
        >
          <DockIcon size={16} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close side chat"
          title={`Close side chat (${shortcut})`}
          className={iconButton}
        >
          <X size={16} />
        </button>
      </div>

      <div className="mt-1 flex min-h-6 flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-disabled="true"
          title="Side chats are always in Chat mode"
          className="focus-ring inline-flex h-6 items-center gap-1 rounded-[var(--glass-radius-sm)] glass-button px-2 text-[11px] font-medium text-zinc-300 opacity-60"
        >
          <MessageSquare size={12} />
          Chat
        </button>
        <ModelSelector currentModel={model} onModelChange={onModelChange} disabled={modelDisabled} size="sm" />
        <span
          title={trimmed ? `Trimmed to fit ${modelName}'s context` : undefined}
          className="min-w-0 max-w-full truncate text-[11px] text-zinc-400"
        >
          {trimmed ? `Sees the last ${shown} messages of ` : "Sees "}
          <Link
            href={`/c/${parentId}`}
            onClick={openParent}
            className="focus-ring rounded-sm hover:text-[var(--foreground)] hover:underline"
          >
            &quot;{parentTitle}&quot;
          </Link>
          {trimmed ? null : " live"}
        </span>
      </div>
    </div>
  );
}
