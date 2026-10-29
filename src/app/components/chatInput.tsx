"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Plus, Upload, Globe, BookOpen, Settings, X, Slash, Mic, MicOff, ArrowRight, Loader2, Paperclip } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import AttachmentChip from "./AttachmentChip";
import QuoteCards from "./QuoteCards";
import DragOverlay from "./DragOverlay";
import ContextUsageCircle from "./ContextUsageCircle";
import ModelSelector from "./conversation/ModelSelector";
import WorkingFolderPicker from "./conversation/WorkingFolderPicker";
import { isCliModelId } from "@/lib/providers";
import VoiceWaveform from "./VoiceWaveform";
import {
  activeCommandQuery,
  matchCommands,
  type SlashCommand,
} from "@/lib/commands";
import { useVoiceDictation } from "@/lib/useVoiceDictation";
import { useChatMode } from "@/app/contexts/ChatModeContext";
import type { QuoteCard } from "@/lib/utils/quoteReply";

/** Max composer height before it starts scrolling. */
const MAX_INPUT_HEIGHT = 200;
/** Above this the text has wrapped — one line measures ~32px. */
const SINGLE_LINE_HEIGHT = 40;

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  files: File[];
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  isLoading: boolean;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onStop: () => void;
  kbId?: string;
  contextUsage?: {
    usedTokens: number;
    maxContextTokens: number;
    contextPercent: number;
  } | null;
  onContextClick?: () => void;
  isCompressed?: boolean;
  isCompressing?: boolean;
  model: string;
  onModelChange: (modelId: string) => void;
  onOpenSettings: () => void;
  /** CLI-backed models only: folder the tool may read (chat) or edit (agent). */
  workingFolder?: string | null;
  onWorkingFolderChange?: (folder: string | null) => void;
  onKbToggle: () => void;
  searchProvider: "duckduckgo" | "tavily";
  onToggleSearchProvider: () => void;
  /** Suggested next message, shown as the placeholder while the box is empty. */
  suggestion?: string | null;
  onAcceptSuggestion?: () => void;
  quotes: QuoteCard[];
  onQuoteChange: (id: string, instruction: string) => void;
  onQuoteRemove: (id: string) => void;
  /** Cmd/Ctrl+Enter in a quote card: send just that card. */
  onSendQuote: (id: string) => void;
  /** Temporary chat: dashed composer and its own placeholder. */
  temporary?: boolean;
}

export default function ChatInput({
  input,
  setInput,
  files,
  setFiles,
  isLoading,
  onSubmit,
  onStop,
  kbId,
  contextUsage,
  onContextClick,
  isCompressed,
  isCompressing,
  model,
  onModelChange,
  onOpenSettings,
  workingFolder,
  onWorkingFolderChange,
  onKbToggle,
  searchProvider,
  onToggleSearchProvider,
  suggestion,
  onAcceptSuggestion,
  quotes,
  onQuoteChange,
  onQuoteRemove,
  onSendQuote,
  temporary,
}: ChatInputProps) {
  // Read-only here; the sidebar and header toggles do the actual switching.
  const { mode } = useChatMode();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [, setDragCounter] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submitLockRef = useRef(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [compressedDismissed, setCompressedDismissed] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);

  const inputRef = useRef(input);
  inputRef.current = input;

  const { isListening, toggle: toggleVoice, isSupported: voiceSupported } =
    useVoiceDictation(
      useCallback(
        (text: string) => {
          const current = inputRef.current;
          setInput(current + (current && !current.endsWith(" ") ? " " : "") + text);
        },
        [setInput],
      ),
    );

  const cmdQuery = activeCommandQuery(input);
  const cmdMatches: SlashCommand[] = cmdQuery !== null ? matchCommands(cmdQuery) : [];
  const [cmdIndex, setCmdIndex] = useState(0);
  const [cmdDismissed, setCmdDismissed] = useState<string | null>(null);
  const showCommands =
    cmdQuery !== null &&
    cmdQuery !== cmdDismissed &&
    cmdMatches.length > 0;

  useEffect(() => {
    setCmdIndex((i) => (i >= cmdMatches.length ? 0 : i));
  }, [cmdMatches.length]);

  const applyCommand = useCallback(
    (cmd: SlashCommand) => {
      setInput(`/${cmd.name} `);
    },
    [setInput],
  );

  const addFiles = useCallback(
    (incoming: File[]) => {
      setFiles((prev) => {
        const merged = [...prev];
        incoming.forEach((file) => {
          const exists = merged.some(
            (f) =>
              f.name === file.name &&
              f.size === file.size &&
              f.lastModified === file.lastModified,
          );
          if (!exists) {
            merged.push(file);
          }
        });
        return merged;
      });
    },
    [setFiles],
  );

  const removeFile = useCallback(
    (index: number) => {
      setFiles((prev) => prev.filter((_, i) => i !== index));
    },
    [setFiles],
  );

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
    setPlusOpen(false);
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(e.target.files || []);
      addFiles(selected);
      e.target.value = "";
    },
    [addFiles],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragCounter((prev) => prev + 1);
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragCounter((prev) => {
      const newCounter = prev - 1;
      if (newCounter === 0) {
        setIsDragging(false);
      }
      return newCounter;
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragCounter(0);
      setIsDragging(false);
      const dropped = Array.from(e.dataTransfer.files);
      addFiles(dropped);
    },
    [addFiles],
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) {
        setPlusOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const canSubmit = input.trim() || files.length > 0 || quotes.length > 0;
  const showSuggestion = Boolean(suggestion && !input && !isLoading && onAcceptSuggestion);

  useEffect(() => {
    if (!isLoading) submitLockRef.current = false;
  }, [isLoading]);

  // The textarea is disabled while a reply runs, so a focus request made then waits for the reply to end.
  const wantFocusRef = useRef(false);
  useEffect(() => {
    if (isLoading || !wantFocusRef.current) return;
    wantFocusRef.current = false;
    if (document.activeElement === document.body) textareaRef.current?.focus();
  }, [isLoading]);

  function focusTextarea() {
    const el = textareaRef.current;
    if (el?.disabled) wantFocusRef.current = true;
    else el?.focus();
  }

  function submitFromKey(e: React.KeyboardEvent) {
    e.preventDefault();
    if (canSubmit && !isLoading && !submitLockRef.current) {
      submitLockRef.current = true;
      wantFocusRef.current = true;
      onSubmit(e as any);
    }
  }

  // Resize on value change rather than onInput, so it also shrinks back after
  // send and still grows for voice dictation and slash-command completion.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const content = el.scrollHeight;
    el.style.height = `${Math.min(content, MAX_INPUT_HEIGHT)}px`;
    // Once it wraps, go full width and let the buttons drop underneath.
    setExpanded(content > SINGLE_LINE_HEIGHT);
  }, [input]);

  return (
    <>
      <DragOverlay isVisible={isDragging} fileCount={files.length} />

      <div className="glass-nav px-4 py-3">
        {isCompressing && (
          <div className="mb-3 flex items-center gap-2 text-sm text-zinc-300">
            <Loader2 size={14} aria-hidden className="animate-spin motion-reduce:animate-none text-amber-400" />
            Compressing chat…
          </div>
        )}

        {isCompressed && !compressedDismissed && (
          <div className="mb-3 p-3 rounded-[var(--glass-radius-md)] glass-card border border-emerald-900/50">
            <div className="flex items-center gap-2 text-emerald-300 text-sm">
              <span className="flex-shrink-0">✦</span>
              <span className="flex-1">Session compressed — using summary for context. Full history preserved.</span>
              <button
                onClick={() => setCompressedDismissed(true)}
                className="flex-shrink-0 rounded p-0.5 text-emerald-500 hover:text-emerald-300 hover:bg-emerald-900/50 transition-colors"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Composer tray: what stacks above the input. Status rows above stay put; this part scrolls. */}
        {(quotes.length > 0 || files.length > 0) && (
          <div className="mb-3 max-h-[min(30dvh,240px)] space-y-2 overflow-y-auto">
            <QuoteCards
              quotes={quotes}
              onChange={onQuoteChange}
              onRemove={onQuoteRemove}
              onSendOne={(id) => {
                wantFocusRef.current = true; // the card leaves, and the textarea is disabled until the reply ends
                onSendQuote(id);
              }}
              onSendAll={submitFromKey}
              focusTextarea={focusTextarea}
              busy={isLoading}
            />
            {files.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <Paperclip size={11} /> Files ({files.length})
                  <button
                    type="button"
                    onClick={() => setFiles([])}
                    className="focus-ring ml-auto rounded-[var(--glass-radius-sm)] px-1 hover:text-[var(--foreground)]"
                  >
                    Clear all
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {files.map((file, index) => (
                    <AttachmentChip
                      key={`${file.name}-${file.size}-${index}`}
                      file={file}
                      onRemove={() => removeFile(index)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <form
          onSubmit={onSubmit}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`
            relative flex flex-wrap items-end gap-x-2 gap-y-1.5 rounded-[var(--glass-radius-xl)] glass px-3 py-2 transition-all duration-200
            ${
              isDragging
                ? "shadow-[var(--glass-shadow-glow)] border-[var(--glass-accent)]"
                : ""
            }
            ${temporary ? "border-dashed! border-[var(--glass-border-strong)]!" : ""}
          `}
        >
          {showCommands && (
            <div className="absolute bottom-full left-0 right-0 mb-2 max-h-72 overflow-y-auto rounded-[var(--glass-radius-md)] glass-panel shadow-2xl z-50">
              <div className="flex items-center gap-1.5 border-b border-[var(--glass-border)] px-3 py-1.5 text-[11px] text-zinc-500">
                <Slash size={11} /> Commands · ↑↓ to navigate · Tab/Enter to select
              </div>
              {cmdMatches.map((cmd, i) => (
                <button
                  key={cmd.name}
                  type="button"
                  onMouseEnter={() => setCmdIndex(i)}
                  onClick={() => applyCommand(cmd)}
                  className={`flex w-full items-baseline gap-2 px-3 py-2 text-left transition ${
                    i === cmdIndex ? "bg-[var(--glass-bg-hover)]" : "hover:bg-[var(--glass-bg-hover)]"
                  }`}
                >
                  <span className="font-mono text-sm text-emerald-400 shrink-0">
                    {cmd.usage}
                  </span>
                  <span className="truncate text-xs text-zinc-400">
                    {cmd.description}
                  </span>
                  {cmd.kind === "action" && (
                    <span className="ml-auto shrink-0 rounded glass px-1.5 py-0.5 text-[10px] text-zinc-500">
                      action
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* One row until the text wraps, then the input takes the full width. */}
          <div className={`relative min-w-0 flex flex-col ${expanded ? "order-1 w-full" : "order-2 flex-1"}`}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                isListening
                  ? ""
                  : suggestion && !input
                    ? suggestion
                  : temporary
                    ? "Temporary chat. Not saved after you leave."
                    : mode === "agent"
                    ? "Agent mode — can write artifacts, todos, memories..."
                    : "Type a message, / for commands, or drop files..."
              }
              className={`w-full resize-none bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-zinc-500 placeholder:truncate disabled:opacity-50 py-1.5 overflow-y-auto ${showSuggestion ? "pr-7" : ""}`}
              rows={1}
              onKeyDown={(e) => {
                if (showCommands) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCmdIndex((i) => (i + 1) % cmdMatches.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCmdIndex((i) => (i - 1 + cmdMatches.length) % cmdMatches.length);
                    return;
                  }
                  if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                    e.preventDefault();
                    applyCommand(cmdMatches[cmdIndex] ?? cmdMatches[0]);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setCmdDismissed(cmdQuery);
                    return;
                  }
                }
                if (e.key === "ArrowRight" && !input && suggestion && onAcceptSuggestion) {
                  e.preventDefault();
                  onAcceptSuggestion();
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  submitFromKey(e);
                }
              }}
              style={{
                minHeight: "36px",
                maxHeight: `${MAX_INPUT_HEIGHT}px`,
              }}
            />

            {/* Suggested next message: fill the box with it (→ key does the same). */}
            {showSuggestion && (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => {
                  onAcceptSuggestion?.();
                  textareaRef.current?.focus();
                }}
                aria-label="Use suggestion"
                title="Use suggestion (→)"
                className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-200 transition"
              >
                <ArrowRight size={14} />
              </button>
            )}

            <AnimatePresence>
              {isListening && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  className="overflow-hidden w-full"
                >
                  <VoiceWaveform isActive={isListening} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className={`relative shrink-0 ${expanded ? "order-2" : "order-1"}`} ref={plusRef}>
            <button
              type="button"
              onClick={() => setPlusOpen(!plusOpen)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--glass-radius-md)] glass-button text-zinc-400"
              aria-label="Add files, web search, or knowledge base"
            >
              <Plus size={18} />
            </button>
            {plusOpen && (
              <div className="absolute bottom-full left-0 mb-2 w-52 glass-panel rounded-[var(--glass-radius-md)] shadow-lg border border-[var(--glass-border)] z-50 overflow-hidden">
                <button
                  type="button"
                  onClick={handleFileSelect}
                  className="flex w-full items-center gap-3 px-4 py-3 text-sm text-zinc-200 hover:bg-[var(--glass-bg-hover)] transition"
                >
                  <Upload size={16} className="text-zinc-400" />
                  <span>Upload File</span>
                  {files.length > 0 && (
                    <span className="ml-auto text-xs text-zinc-500">{files.length}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onToggleSearchProvider();
                    setPlusOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-sm text-zinc-200 hover:bg-[var(--glass-bg-hover)] transition"
                >
                  <Globe size={16} className={
                    searchProvider === "tavily" ? "text-emerald-400" : "text-zinc-400"
                  } />
                  <span>Web Search</span>
                  <span className="ml-auto text-xs text-zinc-500">
                    {searchProvider === "tavily" ? "Tavily" : "DDG"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenSettings();
                    setPlusOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-sm text-zinc-200 hover:bg-[var(--glass-bg-hover)] transition border-b border-[var(--glass-border)]"
                >
                  <Settings size={16} className="text-zinc-400" />
                  <span>Model Settings</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (kbId) {
                      onKbToggle();
                    } else {
                      onOpenSettings();
                    }
                    setPlusOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-sm transition ${
                    kbId
                      ? "text-blue-300 bg-blue-950/40 hover:bg-blue-900/40"
                      : "text-zinc-200 hover:bg-[var(--glass-bg-hover)]"
                  }`}
                >
                  <BookOpen size={16} className={kbId ? "text-blue-400" : "text-zinc-400"} />
                  <span>Knowledge Base</span>
                  {kbId ? (
                    <span className="ml-auto text-xs text-blue-400">Active</span>
                  ) : (
                    <span className="ml-auto text-xs text-zinc-500">Off</span>
                  )}
                </button>
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileChange}
            className="hidden"
            accept="image/*,.pdf,.doc,.docx,.txt,.md"
          />

          <div className="order-3 ml-auto flex items-center gap-1.5">
            {/* Reads like a second placeholder when the box is empty. */}
            {input.length > 0 && (
              <span className="text-[11px] text-zinc-600 hidden md:block mr-1 whitespace-nowrap">
                {isLoading ? "Type ahead · Enter sends when the reply finishes" : "Enter to send · Shift+Enter for newline"}
              </span>
            )}
            {contextUsage && (
              <ContextUsageCircle
                usedTokens={contextUsage.usedTokens}
                maxContextTokens={contextUsage.maxContextTokens}
                contextPercent={contextUsage.contextPercent}
                onClick={onContextClick}
                className="mr-0.5 hidden md:flex"
              />
            )}

            <div className="hidden md:block">
              <ModelSelector
                currentModel={model}
                onModelChange={onModelChange}
                onOpenSettings={onOpenSettings}
                disabled={isLoading}
                size="sm"
              />
            </div>

            {isCliModelId(model) && onWorkingFolderChange && (
              <div className="hidden md:block">
                <WorkingFolderPicker
                  value={workingFolder ?? null}
                  onChange={onWorkingFolderChange}
                  disabled={isLoading}
                />
              </div>
            )}

            {voiceSupported && (
              <button
                type="button"
                onClick={toggleVoice}
                disabled={isLoading}
                className={`flex h-9 w-9 items-center justify-center rounded-[var(--glass-radius-md)] transition-all ${
                  isListening
                    ? "glass-button-primary text-white"
                    : "glass-button text-zinc-400"
                } disabled:opacity-50`}
                style={isListening ? { animation: "mic-pulse 2s ease-in-out infinite" } : undefined}
                title={isListening ? "Stop dictation" : "Voice dictation"}
              >
                {isListening ? (
                  <Mic size={16} className="animate-pulse" />
                ) : (
                  <MicOff size={16} />
                )}
              </button>
            )}

            {isLoading ? (
              <button
                type="button"
                onClick={onStop}
                className="flex h-9 items-center justify-center rounded-[var(--glass-radius-md)] glass-button-danger px-3 text-sm font-medium text-red-200"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSubmit}
                className="flex h-9 items-center justify-center rounded-[var(--glass-radius-md)] glass-button-primary px-3 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
