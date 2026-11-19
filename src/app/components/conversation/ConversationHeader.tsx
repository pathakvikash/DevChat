"use client";

import { AlertCircle, Download, GitFork, Keyboard, MoreHorizontal, MessageSquareDashed, PanelLeft, PanelLeftClose, Settings2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState, useRef, useEffect, type KeyboardEvent, type ReactNode } from "react";
import { useSidebar } from "@/app/contexts/SidebarContext";
import { useChatMode } from "@/app/contexts/ChatModeContext";
import ModeToggle from "../ModeToggle";
import { exportChat } from "@/lib/utils/download";
import { useToast } from "@/app/components/Toast";

interface ConversationHeaderProps {
  conversation: {
    id: string;
    title: string;
    temporary?: boolean;
    forkedFrom?: { id: string; title: string } | null;
  };
  messagesCount: number;
  enabledToolsCount: number;
  enabledSkillsCount: number;
  onOpenAdvanced: () => void;
  onOpenKeyboardShortcuts?: () => void;
  error?: { message?: string } | null;
  onToggleTemporary?: () => void;
  /** Tools allowed for this chat in Ask mode; the reset item shows only when there are some. */
  allowedToolCount?: number;
  onResetAllowedTools?: () => void;
  /** The Activity and Panel buttons (each owns its popover); the pane builds them. */
  activity?: ReactNode;
  launcher?: ReactNode;
  /** The sidebar toggle shows in the first pane only. */
  showSidebarToggle?: boolean;
}

const MENU_ITEM = "focus-ring flex w-full items-center gap-3 px-4 py-3 text-sm text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)] transition";

export default function ConversationHeader({
  conversation,
  messagesCount,
  enabledToolsCount,
  enabledSkillsCount,
  onOpenAdvanced,
  allowedToolCount = 0,
  onResetAllowedTools,
  onOpenKeyboardShortcuts,
  error,
  onToggleTemporary,
  activity,
  launcher,
  showSidebarToggle = true,
}: ConversationHeaderProps) {
  const { toggle, toggleCollapsed, collapsed } = useSidebar();
  const { toast } = useToast();
  const { mode, setMode, modelCaps } = useChatMode();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (moreOpen) moreRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [moreOpen]);

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const items = [...(moreRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setMoreOpen(false);
      moreButton.current?.focus();
      return;
    }
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (next === undefined) {
      if (e.key === "Tab") setMoreOpen(false);
      return;
    }
    e.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  }

  const run = (fn?: () => void) => () => {
    setMoreOpen(false);
    fn?.();
  };

  return (
    <div className="glass-nav relative z-20">
      <div className="px-3 py-2.5 @lg:px-4">
        <div className="flex items-center gap-2">
          {showSidebarToggle && (
            <>
              {/* Below md the sidebar is a drawer; from md up it collapses. */}
              <button onClick={toggle} className="focus-ring md:hidden flex size-8 shrink-0 items-center justify-center glass-button rounded-[var(--glass-radius-md)]" title="Toggle sidebar" aria-label="Toggle sidebar">
                <PanelLeft size={16} aria-hidden />
              </button>
              <button
                onClick={toggleCollapsed}
                className="focus-ring hidden md:flex size-8 shrink-0 items-center justify-center glass-button rounded-[var(--glass-radius-md)]"
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!collapsed}
              >
                {collapsed ? <PanelLeft size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
              </button>
            </>
          )}
          {/* min-w-0 or the title refuses to truncate and squeezes the actions. */}
          <h1 className="min-w-0 flex-1 text-lg font-bold truncate text-[var(--foreground)]">
            {conversation.temporary && conversation.title === "New Chat" ? "Temporary chat" : conversation.title}
          </h1>
          {conversation.forkedFrom && (
            <span className="hidden min-w-0 items-center gap-1 text-xs text-zinc-400 @2xl:inline-flex">
              <GitFork size={12} className="shrink-0" /> Forked from
              <Link href={`/c/${conversation.forkedFrom.id}`} className="focus-ring max-w-[160px] truncate rounded-sm hover:text-[var(--foreground)] hover:underline">
                {conversation.forkedFrom.title}
              </Link>
            </span>
          )}
          {conversation.temporary && (
            <span className="hidden shrink-0 items-center gap-1 text-xs text-zinc-400 @3xl:inline-flex">
              <MessageSquareDashed size={12} /> Temporary chat · deleted when you leave
            </span>
          )}
          <p className="hidden shrink-0 text-xs text-[var(--foreground)]/50 @lg:block">{messagesCount} messages</p>
          {onToggleTemporary && messagesCount === 0 && (
            <button
              type="button"
              onClick={onToggleTemporary}
              aria-pressed={!!conversation.temporary}
              aria-label="Temporary chat"
              title="Temporary chat: not saved in your history, no memory. Deleted when you leave or after 24 hours."
              className={`focus-ring flex h-7 items-center justify-center gap-1.5 rounded-[var(--glass-radius-md)] px-1.5 text-xs font-medium text-[var(--foreground)] transition shrink-0 @lg:px-2.5 ${
                conversation.temporary ? "glass-strong border-dashed!" : "glass-button"
              }`}
            >
              <MessageSquareDashed size={16} />
              <span className="hidden @lg:inline">Temporary</span>
            </button>
          )}
          <ModeToggle mode={mode} onModeChange={setMode} toolsAvailable={modelCaps.toolsAvailable} />
          {activity}
          {launcher}
          <div ref={moreRef} className="relative">
            <button
              ref={moreButton}
              onClick={() => setMoreOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              className="focus-ring flex size-8 items-center justify-center rounded-[var(--glass-radius-md)] text-xs transition glass-button text-[var(--foreground)] shrink-0"
              title="More actions"
              aria-label="More actions"
            >
              <MoreHorizontal size={16} aria-hidden />
            </button>
            {moreOpen && (
              <div role="menu" aria-label="More actions" onKeyDown={onMenuKey} className="absolute right-0 top-full mt-1 w-48 glass-panel-strong rounded-[var(--glass-radius-md)] shadow-lg border border-[var(--glass-border-strong)] z-[9999] overflow-hidden">
                <button role="menuitem" tabIndex={-1} onClick={run(onOpenAdvanced)} className={MENU_ITEM}>
                  <Settings2 size={14} aria-hidden />
                  <span>Advanced tools</span>
                  {enabledToolsCount + enabledSkillsCount > 0 && (
                    <span className="ml-auto text-[10px] bg-[var(--glass-bg)] px-1.5 py-0.5 rounded text-[var(--foreground)]">
                      {enabledToolsCount + enabledSkillsCount}
                    </span>
                  )}
                </button>
                {allowedToolCount > 0 && onResetAllowedTools && (
                  <button role="menuitem" tabIndex={-1} onClick={run(onResetAllowedTools)} className={MENU_ITEM}>
                    <ShieldCheck size={14} aria-hidden />
                    <span>Reset allowed tools</span>
                  </button>
                )}
                <button role="menuitem" tabIndex={-1} onClick={run(onOpenKeyboardShortcuts)} className={MENU_ITEM}>
                  <Keyboard size={14} aria-hidden />
                  <span>Shortcuts</span>
                </button>
                <div role="separator" className="border-t border-[var(--glass-border)]" />
                <button role="menuitem" tabIndex={-1} onClick={run(() => exportChat(conversation.id, "markdown", toast))} className={MENU_ITEM}>
                  <Download size={14} aria-hidden />
                  <span>Export Markdown</span>
                </button>
                <button role="menuitem" tabIndex={-1} onClick={run(() => exportChat(conversation.id, "json", toast))} className={MENU_ITEM}>
                  <Download size={14} aria-hidden />
                  <span>Export JSON</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-[var(--glass-radius-md)] border border-red-500/30 bg-red-500/10 backdrop-blur-[var(--glass-blur-sm)] px-4 py-3 text-sm text-red-600">
            <AlertCircle size={18} className="shrink-0 mt-0.5 text-red-500" />
            <div className="flex-1">
              <div className="font-medium">
                {error.message?.includes("API key") ? "API key required" : "Chat error"}
              </div>
              <div className="text-red-500/80 wrap-break-word">
                {error.message || "Failed to get a response. Check your API key or try a different model."}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
