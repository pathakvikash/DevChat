"use client";

import type { ChatMode } from "@/app/components/conversation/types";
import { useEffect, useRef, useState, useCallback } from "react";
import { Plus, Upload, Globe, BookOpen, Settings, X, Slash, Mic, MicOff, ArrowRight, Loader2, Paperclip, AtSign, FileText } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import AttachmentChip from "./AttachmentChip";
import QuoteCards from "./QuoteCards";
import QueuedMessages, { type QueuedItem } from "./QueuedMessages";
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
import type { QuoteCard } from "@/lib/utils/quoteReply";
import { findMentionQuery, formatSize, matchMentionFiles } from "@/lib/utils/fileMentions";

/** Max composer height before it starts scrolling. */
const MAX_INPUT_HEIGHT = 200;
/** Above this the text has wrapped — one line measures ~32px. */
const SINGLE_LINE_HEIGHT = 40;

interface ChatInputProps {
  /** The pane's mode. The sidebar and header toggles switch it. */
  mode: ChatMode;
  input: string;
  setInput: (value: string) => void;
  files: File[];
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  isLoading: boolean;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
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
  compressFocus?: string;
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
  conversationId: string;
  /** Working-folder paths picked with `@`; shown as chips. */
  mentions: string[];
  setMentions: React.Dispatch<React.SetStateAction<string[]>>;
  /** Kept and total lines for each `@` file that will be cut on send. */
  mentionCuts?: Record<string, { kept: number; total: number }>;
  /** Messages typed during a reply, shown as chips above the input. */
  queued?: QueuedItem[];
  /** Enter or Queue during a reply: queue what is typed. */
  onQueue?: () => void;
  onQueueEdit?: (id: string, text: string) => void;
  onQueueRemove?: (id: string) => void;
  onQueueRetry?: (id: string) => void;
  /** Queued messages join a running reply only when the model has tools. */
  toolsAvailable?: boolean;
}

export default function ChatInput({
  mode,
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
  compressFocus,
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
  conversationId,
  mentions,
  setMentions,
  mentionCuts = {},
  queued = [],
  onQueue = () => {},
  onQueueEdit = () => {},
  onQueueRemove = () => {},
  onQueueRetry = () => {},
  toolsAvailable = true,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [, setDragCounter] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  // `@` picks a file from the working folder. Only with a folder; the slash menu wins when both match.
  const [caret, setCaret] = useState(0);
  const mentionQuery = workingFolder ? findMentionQuery(input, caret) : null;
  const mentionKey = mentionQuery ? `${mentionQuery.start}:${mentionQuery.query}` : null;
  const [mentionDismissed, setMentionDismissed] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const showMentions = mentionQuery !== null && mentionKey !== mentionDismissed && !showCommands;
  // The list belongs to one chat and folder. It is fetched when the picker first opens, and again after a failure.
  const listKey = `${conversationId}|${workingFolder ?? ""}`;
  const [folderList, setFolderList] = useState<{ key: string; status: "ready" | "error"; files: { path: string; size: number }[] } | null>(null);
  const listingKeyRef = useRef<string | null>(null);
  const list = folderList?.key === listKey ? folderList : null;
  const mentionMatches =
    showMentions && mentionQuery && list?.status === "ready" ? matchMentionFiles(list.files, mentionQuery.query) : [];
  const activeMention = mentionIndex < mentionMatches.length ? mentionIndex : 0;

  useEffect(() => {
    if (!showMentions || listingKeyRef.current === listKey) return;
    listingKeyRef.current = listKey;
    fetch(`/api/conversations/${conversationId}/files`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setFolderList({ key: listKey, status: "ready", files: d.files }))
      .catch(() => {
        listingKeyRef.current = null;
        setFolderList({ key: listKey, status: "error", files: [] });
      });
  }, [showMentions, listKey, conversationId]);

  // After a pick the text changes, and React would move the caret to the end. Put it back here.
  const caretAfterPick = useRef<number | null>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (caretAfterPick.current === null || !el) return;
    el.setSelectionRange(caretAfterPick.current, caretAfterPick.current);
    caretAfterPick.current = null;
  }, [input]);

  function pickMention(path: string) {
    if (!mentionQuery) return;
    const pos = mentionQuery.start;
    setInput(input.slice(0, pos) + input.slice(caret));
    setCaret(pos);
    setMentions((prev) => (prev.includes(path) ? prev : [...prev, path]));
    caretAfterPick.current = pos;
    textareaRef.current?.focus();
  }

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

  const canSubmit = input.trim() || files.length > 0 || mentions.length > 0 || quotes.length > 0;
  const showSuggestion = Boolean(suggestion && !input && !isLoading && onAcceptSuggestion);

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
    if (isLoading) {
      // Holding Enter queues once.
      if (!e.repeat) onQueue();
      return;
    }
    if (canSubmit) {
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
          <div className="mb-3 flex items-center gap-2 text-sm text-[var(--foreground)]">
            <Loader2 size={14} aria-hidden className="animate-spin motion-reduce:animate-none text-amber-400" />
            {compressFocus
              ? `Compressing chat, keeping "${compressFocus.length > 40 ? `${compressFocus.slice(0, 40)}…` : compressFocus}"…`
              : "Compressing chat…"}
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
        {(queued.length > 0 || quotes.length > 0 || files.length > 0 || mentions.length > 0) && (
          <div className="mb-3 max-h-[min(30dvh,240px)] space-y-2 overflow-y-auto">
            <QueuedMessages
              items={queued}
              toolsAvailable={toolsAvailable}
              onEdit={onQueueEdit}
              onRemove={onQueueRemove}
              onRetry={onQueueRetry}
              focusTextarea={focusTextarea}
            />
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
            {(files.length > 0 || mentions.length > 0) && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <Paperclip size={11} /> Files ({files.length + mentions.length})
                  <button
                    type="button"
                    onClick={() => {
                      setFiles([]);
                      setMentions([]);
                    }}
                    className="focus-ring ml-auto rounded-[var(--glass-radius-sm)] px-1 hover:text-[var(--foreground)]"
                  >
                    Clear all
                  </button>
                </div>
                <div role="list" aria-label="Files" className="flex flex-wrap gap-2">
                  {files.map((file, index) => (
                    <AttachmentChip
                      key={`${file.name}-${file.size}-${index}`}
                      file={file}
                      onRemove={() => removeFile(index)}
                    />
                  ))}
                  {mentions.map((path) => {
                    const cut = mentionCuts[path];
                    const modelName = model.split("/").pop() || model;
                    return (
                      <AttachmentChip
                        key={`@${path}`}
                        file={{ name: path }}
                        note={
                          cut && {
                            text: `Trimmed to fit ${modelName}: ${cut.total === 1 ? "part of the only line" : `${cut.kept} of ${cut.total} lines`} sent`,
                            title: cut.total === 1 ? "Only part of this line fits this model" : `Only the first ${cut.kept} of ${cut.total} lines fit this model`,
                          }
                        }
                        onRemove={() => setMentions((prev) => prev.filter((p) => p !== path))}
                      />
                    );
                  })}
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
          {showMentions && (
            <div className="absolute bottom-full left-0 right-0 mb-2 max-h-72 overflow-y-auto rounded-[var(--glass-radius-md)] glass-panel shadow-2xl z-50">
              <div className="flex items-center gap-1.5 border-b border-[var(--glass-border)] px-3 py-1.5 text-[11px] text-zinc-500">
                <AtSign size={11} /> Files in {workingFolder?.split("/").pop()} · ↑↓ to navigate · Tab/Enter to select
              </div>
              {list?.status === "error" ? (
                <div className="px-3 py-2 text-xs text-zinc-400">Couldn&apos;t list files</div>
              ) : list?.status !== "ready" ? (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-400">
                  <Loader2 size={12} aria-hidden className="animate-spin motion-reduce:animate-none" /> Loading files…
                </div>
              ) : mentionMatches.length === 0 ? (
                <div className="px-3 py-2 text-xs text-zinc-400">No files match &quot;{mentionQuery?.query}&quot;</div>
              ) : (
                mentionMatches.map(({ path, size }, i) => (
                  <button
                    key={path}
                    type="button"
                    onMouseEnter={() => setMentionIndex(i)}
                    onClick={() => pickMention(path)}
                    className={`focus-ring flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                      i === activeMention ? "bg-[var(--glass-bg-hover)]" : "hover:bg-[var(--glass-bg-hover)]"
                    }`}
                  >
                    <FileText size={14} aria-hidden className="shrink-0 text-zinc-500" />
                    <span className="truncate text-[var(--foreground)]">{path.slice(path.lastIndexOf("/") + 1)}</span>
                    {path.includes("/") && (
                      <span className="min-w-0 truncate text-xs text-zinc-400">{path.slice(0, path.lastIndexOf("/"))}</span>
                    )}
                    <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-400">{formatSize(size)}</span>
                  </button>
                ))
              )}
            </div>
          )}

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
              aria-label="Message"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setCaret(e.target.selectionStart);
                setMentionIndex(0);
              }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
              placeholder={
                isListening
                  ? ""
                  : suggestion && !input
                    ? suggestion
                  : temporary
                    ? "Temporary chat. Not saved after you leave."
                    : mode === "agent"
                    ? "Agent mode: can make changes without asking"
                    : mode === "ask"
                      ? isCliModelId(model) && !model.startsWith("claude-code/") ? "Ask mode: OpenCode and Codex can't ask before editing; read-only here" : "Ask mode: changes need your OK"
                      : mode === "plan"
                        ? "Describe the task. You'll get a plan to approve."
                        : "Type a message, / for commands, or drop files..."
              }
              className={`w-full resize-none bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-zinc-500 placeholder:truncate disabled:opacity-50 py-1.5 overflow-y-auto ${showSuggestion ? "pr-7" : ""}`}
              rows={1}
              onKeyDown={(e) => {
                if (showMentions) {
                  if (e.key === "ArrowDown" && mentionMatches.length > 0) {
                    e.preventDefault();
                    setMentionIndex((i) => (i + 1) % mentionMatches.length);
                    return;
                  }
                  if (e.key === "ArrowUp" && mentionMatches.length > 0) {
                    e.preventDefault();
                    setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
                    return;
                  }
                  if (e.key === "Tab" && mentionMatches.length > 0) {
                    e.preventDefault();
                    pickMention(mentionMatches[activeMention].path);
                    return;
                  }
                  // Enter picks, or does nothing while the list loads or matches nothing. It never sends.
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (mentionMatches.length > 0) pickMention(mentionMatches[activeMention].path);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setMentionDismissed(mentionKey);
                    return;
                  }
                }
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
              <span className="text-[11px] text-zinc-400 hidden md:block mr-1 whitespace-nowrap">
                {isLoading
                  ? toolsAvailable
                    ? "Enter queues · the model sees it at its next step"
                    : "Enter queues · sends when the reply finishes"
                  : "Enter to send · Shift+Enter for newline"}
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
              <>
                {input.trim() && (
                  <button
                    type="button"
                    onClick={onQueue}
                    className="flex h-9 items-center justify-center rounded-[var(--glass-radius-md)] glass-button px-3 text-sm font-medium text-[var(--foreground)]"
                  >
                    Queue
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onStop();
                    // Stop puts the undelivered text back in the box; the cursor ends up at its end.
                    textareaRef.current?.focus();
                  }}
                  className="flex h-9 items-center justify-center rounded-[var(--glass-radius-md)] glass-button-danger px-3 text-sm font-medium text-red-200"
                >
                  Stop
                </button>
              </>
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
