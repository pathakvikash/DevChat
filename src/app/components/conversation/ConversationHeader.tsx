"use client";

import { Code2, Settings2, AlertCircle, Download, FileCode, GitFork, Menu, Keyboard, Brain, MoreHorizontal, MessageSquareDashed, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { useSidebar } from "@/app/contexts/SidebarContext";
import { useChatMode } from "@/app/contexts/ChatModeContext";
import ModeToggle from "../ModeToggle";
import { formatContext } from "@/lib/utils/messageParts";
import { exportChat } from "@/lib/utils/download";
import { useToast } from "@/app/components/Toast";

interface ConversationHeaderProps {
  conversation: {
    id: string;
    title: string;
    model: string;
    systemPrompt?: string;
    temperature: number;
    contextLength?: number;
    topP?: number;
    maxTokens?: number;
    memoryDisabled?: boolean;
    temporary?: boolean;
    forkedFrom?: { id: string; title: string } | null;
  };
  messagesCount: number;
  scratchpadOpen: boolean;
  onToggleScratchpad: () => void;
  artifactsOpen: boolean;
  onToggleArtifacts: () => void;
  enabledToolsCount: number;
  enabledSkillsCount: number;
  onOpenAdvanced: () => void;
  onOpenKeyboardShortcuts?: () => void;
  error?: { message?: string } | null;
  onToggleMemory?: () => void;
  onToggleTemporary?: () => void;
  /** Tools allowed for this chat in Ask mode; the reset item shows only when there are some. */
  allowedToolCount?: number;
  onResetAllowedTools?: () => void;
}

export default function ConversationHeader({
  conversation,
  messagesCount,
  scratchpadOpen,
  onToggleScratchpad,
  artifactsOpen,
  onToggleArtifacts,
  enabledToolsCount,
  enabledSkillsCount,
  onOpenAdvanced,
  allowedToolCount = 0,
  onResetAllowedTools,
  onOpenKeyboardShortcuts,
  error,
  onToggleMemory,
  onToggleTemporary,
}: ConversationHeaderProps) {
  const { toggle } = useSidebar();
  const { toast } = useToast();
  const { mode, setMode, modelCaps } = useChatMode();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="glass-nav relative z-20">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button onClick={toggle} className="md:hidden p-1.5 glass-button rounded transition shrink-0" title="Toggle sidebar">
            <Menu size={18} />
          </button>
          {/* min-w-0 or the title refuses to truncate and squeezes the actions. */}
          <h1 className="min-w-0 flex-1 text-lg font-bold truncate text-[var(--foreground)]">
            {conversation.temporary && conversation.title === "New Chat" ? "Temporary chat" : conversation.title}
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            {onToggleTemporary && messagesCount === 0 && (
              <button
                type="button"
                onClick={onToggleTemporary}
                aria-pressed={!!conversation.temporary}
                aria-label="Temporary chat"
                title="Temporary chat: not saved in your history, no memory. Deleted when you leave or after 24 hours."
                className={`focus-ring flex h-7 items-center justify-center gap-1.5 rounded-[var(--glass-radius-md)] px-1.5 text-xs font-medium text-[var(--foreground)] transition shrink-0 sm:px-2.5 ${
                  conversation.temporary
                    ? "glass-strong border-dashed!"
                    : "glass-button"
                }`}
              >
                <MessageSquareDashed size={16} />
                <span className="hidden sm:inline">Temporary</span>
              </button>
            )}
            <ModeToggle mode={mode} onModeChange={setMode} toolsAvailable={modelCaps.toolsAvailable} cli={modelCaps.cli} />
            {/* These move into the More menu on small screens. */}
            <div className="hidden sm:flex items-center gap-2">
              <button
                onClick={onToggleScratchpad}
                className={`flex items-center justify-center rounded-[var(--glass-radius-md)] p-1.5 transition shrink-0 ${
                  scratchpadOpen
                    ? "glass-button-primary text-white"
                    : "glass-button text-[var(--foreground)]"
                }`}
                title="Toggle scratchpad"
              >
                <Code2 size={16} />
              </button>
              <button
                onClick={onToggleArtifacts}
                className={`flex items-center justify-center rounded-[var(--glass-radius-md)] p-1.5 transition shrink-0 ${
                  artifactsOpen
                    ? "glass-button-primary text-white"
                    : "glass-button text-[var(--foreground)]"
                }`}
                title="Toggle artifacts"
              >
                <FileCode size={16} />
              </button>
            </div>
            <div ref={moreRef} className="relative">
              <button
                onClick={() => setMoreOpen((v) => !v)}
                className="flex items-center justify-center rounded-[var(--glass-radius-md)] px-2 py-1.5 text-xs transition glass-button text-[var(--foreground)] shrink-0"
                title="More actions"
              >
                <MoreHorizontal size={16} />
              </button>
              {moreOpen && (
                <div className="absolute right-0 top-full mt-1 w-44 glass-panel-strong rounded-[var(--glass-radius-md)] shadow-lg border border-[var(--glass-border-strong)] z-[9999] overflow-hidden">
                  {/* Mirrors the header toggles that are hidden on small screens. */}
                  <button
                    onClick={() => { setMoreOpen(false); onToggleScratchpad(); }}
                    className="sm:hidden flex w-full items-center gap-3 px-4 py-3 text-sm text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)] transition"
                  >
                    <Code2 size={14} />
                    <span>Scratchpad {scratchpadOpen ? "(open)" : ""}</span>
                  </button>
                  <button
                    onClick={() => { setMoreOpen(false); onToggleArtifacts(); }}
                    className="sm:hidden flex w-full items-center gap-3 px-4 py-3 text-sm text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)] transition"
                  >
                    <FileCode size={14} />
                    <span>Artifacts {artifactsOpen ? "(open)" : ""}</span>
                  </button>
                  <div className="sm:hidden border-t border-[var(--glass-border)]" />
                  {onToggleMemory && (
                    <button
                      // aria-disabled, not disabled, so the label stays readable and focusable.
                      aria-disabled={conversation.temporary || undefined}
                      onClick={() => { if (conversation.temporary) return; setMoreOpen(false); onToggleMemory(); }}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-sm transition ${
                        conversation.memoryDisabled || conversation.temporary
                          ? "text-[var(--foreground)]/50 hover:bg-[var(--glass-bg-hover)]"
                          : "text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)]"
                      }`}
                    >
                      <Brain size={14} />
                      <span>
                        {conversation.temporary
                          ? "Memory (off in temporary chats)"
                          : `Memory ${conversation.memoryDisabled ? "(off)" : "(on)"}`}
                      </span>
                    </button>
                  )}
                  <button
                    onClick={() => { setMoreOpen(false); onOpenAdvanced(); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)] transition"
                  >
                    <Settings2 size={14} />
                    <span>Advanced</span>
                    {enabledToolsCount + enabledSkillsCount > 0 && (
                      <span className="ml-auto text-[10px] bg-[var(--glass-bg)] px-1.5 py-0.5 rounded text-[var(--foreground)]">
                        {enabledToolsCount + enabledSkillsCount}
                      </span>
                    )}
                  </button>
                  {allowedToolCount > 0 && onResetAllowedTools && (
                    <button
                      onClick={() => { setMoreOpen(false); onResetAllowedTools(); }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-sm text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)] transition"
                    >
                      <ShieldCheck size={14} />
                      <span>Reset allowed tools</span>
                    </button>
                  )}
                  <button
                    onClick={() => { setMoreOpen(false); onOpenKeyboardShortcuts?.(); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)] transition"
                  >
                    <Keyboard size={14} />
                    <span>Shortcuts</span>
                  </button>
                  <div className="border-t border-[var(--glass-border)]" />
                  <button
                    onClick={() => { setMoreOpen(false); exportChat(conversation.id, "markdown", toast); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)] transition"
                  >
                    <Download size={14} />
                    <span>Export Markdown</span>
                  </button>
                  <button
                    onClick={() => { setMoreOpen(false); exportChat(conversation.id, "json", toast); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)] transition"
                  >
                    <Download size={14} />
                    <span>Export JSON</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1">
          {conversation.forkedFrom && (
            <span className="inline-flex min-w-0 items-center gap-1 text-xs text-zinc-400">
              <GitFork size={12} className="shrink-0" /> Forked from
              <Link href={`/c/${conversation.forkedFrom.id}`} className="focus-ring max-w-[200px] truncate rounded-sm hover:text-[var(--foreground)] hover:underline">
                {conversation.forkedFrom.title}
              </Link>
            </span>
          )}
          {conversation.temporary && (
            <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
              <MessageSquareDashed size={12} /> Temporary chat · deleted when you leave
            </span>
          )}
          <p className="text-xs text-[var(--foreground)]/50">{messagesCount} messages</p>
          {conversation.contextLength && (
            <span className="text-xs text-[var(--foreground)]/40">
              Context: {formatContext(conversation.contextLength)}
            </span>
          )}
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
