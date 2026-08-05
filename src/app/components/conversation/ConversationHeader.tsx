"use client";

import { Code2, Settings2, AlertCircle, Download, FileCode, Menu, Target, Keyboard, Brain, MoreHorizontal } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useSidebar } from "@/app/contexts/SidebarContext";
import { formatContext } from "@/lib/utils/messageParts";
import { downloadBlob } from "@/lib/utils/download";

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
  };
  messagesCount: number;
  scratchpadOpen: boolean;
  onToggleScratchpad: () => void;
  artifactsOpen: boolean;
  onToggleArtifacts: () => void;
  goalOpen: boolean;
  onToggleGoal: () => void;
  enabledToolsCount: number;
  enabledSkillsCount: number;
  onOpenAdvanced: () => void;
  onOpenKeyboardShortcuts?: () => void;
  error?: { message?: string } | null;
  onToggleMemory?: () => void;
}

export default function ConversationHeader({
  conversation,
  messagesCount,
  scratchpadOpen,
  onToggleScratchpad,
  artifactsOpen,
  onToggleArtifacts,
  goalOpen,
  onToggleGoal,
  enabledToolsCount,
  enabledSkillsCount,
  onOpenAdvanced,
  onOpenKeyboardShortcuts,
  error,
  onToggleMemory,
}: ConversationHeaderProps) {
  const { toggle } = useSidebar();
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

  function handleExport(format: "markdown" | "json") {
    try {
      const msgs = (conversation as any).messages || [];
      let content = "";
      if (format === "json") {
        content = JSON.stringify(conversation, null, 2);
      } else {
        content = `# ${conversation.title}\n\n**Model:** ${conversation.model}\n`;
        content += `**Created:** ${new Date().toISOString()}\n\n---\n\n`;
        for (const msg of msgs) {
          const role = (msg.role || "").charAt(0).toUpperCase() + (msg.role || "").slice(1);
          const text = msg.content || "";
          if (text) content += `### ${role}\n\n${text}\n\n`;
        }
      }
      const safeTitle = (conversation.title || "conversation").replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "conversation";
      const ext = format === "json" ? "json" : "md";
      const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/markdown" });
      downloadBlob(blob, `${safeTitle}.${ext}`);
    } catch (e) {
      console.error("[ConversationHeader] export error:", e);
    }
  }

  return (
    <div className="glass-nav">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button onClick={toggle} className="md:hidden p-1.5 glass-button rounded transition shrink-0" title="Toggle sidebar">
            <Menu size={18} />
          </button>
          <h1 className="text-lg font-bold truncate text-[var(--foreground)]">{conversation.title}</h1>
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <div className="flex items-center gap-2 overflow-x-auto">
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
              <button
                onClick={onToggleGoal}
                className={`flex items-center justify-center rounded-[var(--glass-radius-md)] p-1.5 transition shrink-0 ${
                  goalOpen
                    ? "glass-button-primary text-white"
                    : "glass-button text-[var(--foreground)]"
                }`}
                title="Goal Mode"
              >
                <Target size={16} />
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
                <div className="absolute right-0 top-full mt-1 w-44 glass-panel rounded-[var(--glass-radius-md)] shadow-lg border border-[var(--glass-border)] z-[9999] overflow-hidden">
                  {onToggleMemory && (
                    <button
                      onClick={() => { setMoreOpen(false); onToggleMemory(); }}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-sm transition ${
                        conversation.memoryDisabled
                          ? "text-[var(--foreground)]/50 hover:bg-[var(--glass-bg-hover)]"
                          : "text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)]"
                      }`}
                    >
                      <Brain size={14} />
                      <span>Memory {conversation.memoryDisabled ? "(off)" : "(on)"}</span>
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
                  <button
                    onClick={() => { setMoreOpen(false); onOpenKeyboardShortcuts?.(); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)] transition"
                  >
                    <Keyboard size={14} />
                    <span>Shortcuts</span>
                  </button>
                  <div className="border-t border-[var(--glass-border)]" />
                  <button
                    onClick={() => { setMoreOpen(false); handleExport("markdown"); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)] transition"
                  >
                    <Download size={14} />
                    <span>Export Markdown</span>
                  </button>
                  <button
                    onClick={() => { setMoreOpen(false); handleExport("json"); }}
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
