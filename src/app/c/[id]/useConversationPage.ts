"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useToast } from "@/app/components/Toast";
import type { Conversation } from "@/app/components/conversation/types";
import { useChatMode } from "@/app/contexts/ChatModeContext";
import type { MinimapMessage } from "@/app/components/MinimapNavigator";
import { parseCommand, missingArg } from "@/lib/commands";
import { buildMessageParts } from "@/lib/utils/messageParts";
import { buildMessagesFromConversation, lastExchange, type RawConversation } from "@/lib/utils/conversation";
import { composeQuoteMessage, type QuoteCard } from "@/lib/utils/quoteReply";
import { composeFileBlocks, cutFiles } from "@/lib/utils/fileMentions";
import { budgetTokens } from "@/lib/chat/contextBudget";

import { fetchSettings as apiFetchSettings, saveSettings as apiSaveSettings } from "@/app/hooks/useSettingsApi";
import { runCommandAction } from "./runCommandAction";
import { useConversationData } from "./useConversationData";
import { useChatTransport, type ChatFinish } from "./useChatTransport";
import { useMessageActions } from "./useMessageActions";
import type { ConversationPageState } from "./types";

export type { ConversationPageState };

// Pending deletes of temporary chats we just left. Module-level, so a remount of the same chat
// (Fast Refresh reset, error "Try again") finds and cancels its own.
const pendingLeave = new Map<string, number>();
const LEAVE_GRACE_MS = 5000;

/** Share of the model's window that all `@` files together may use. */
const FILES_SHARE = 0.35;

/** A picked file's text as the server reads it; null when it refuses or cannot read the file. */
async function readMention(conversationId: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/conversations/${conversationId}/files?path=${encodeURIComponent(path)}`);
    if (!res.ok) return null;
    return (await res.json()).content ?? null;
  } catch {
    return null;
  }
}

function discardTemporaryChat(id: string) {
  // keepalive lets the request outlive the page on a full reload; ?temporary=1 means the server
  // never deletes a chat that stopped being temporary.
  fetch(`/api/conversations/${id}?temporary=1`, { method: "DELETE", keepalive: true }).catch(() => {});
}

export function useConversationPage(conversationId: string, initialPrompt?: string): ConversationPageState {
  const { toast } = useToast();

  /* ─── State ────────────────────────────────────────────────────────────── */

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  /** Working-folder paths picked with `@`; their contents are read on send. */
  const [mentions, setMentions] = useState<string[]>([]);
  /** Kept and total lines of each `@` file that the budget will cut; shown on its chip. */
  const [mentionCuts, setMentionCuts] = useState<Record<string, { kept: number; total: number }>>({});
  const workingFolder = conversation?.workingFolder ?? null;
  // Picked files belong to one folder. When it changes, adjust state during render (no effect needed).
  const [mentionFolder, setMentionFolder] = useState(workingFolder);
  if (mentionFolder !== workingFolder) {
    setMentionFolder(workingFolder);
    setMentions([]);
  }
  /** Text of each picked file, read once per chat and folder. */
  const mentionTextRef = useRef(new Map<string, string | null>());
  const sendingRef = useRef(false);
  /** Suggested next message, shown greyed in the box after a reply. */
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<QuoteCard[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const quoteSeq = useRef(0);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedKbId, setSelectedKbId] = useState<string>("");
  const [scratchpadOpen, setScratchpadOpen] = useState(false);
  const [todoPanelOpen, setTodoPanelOpen] = useState(false);
  const [searchProvider, setSearchProvider] = useState<"duckduckgo" | "tavily">("duckduckgo");
  const { mode } = useChatMode();
  const settingsKey = `vas:advancedSettings:${conversationId}`;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [enabledTools, setEnabledTools] = useState<string[]>([]);
  const [enabledSkills, setEnabledSkills] = useState<string[]>([]);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [contextData, setContextData] = useState<{ usedTokens: number; maxContextTokens: number; contextPercent: number } | null>(null);
  const [toolErrorDialogOpen, setToolErrorDialogOpen] = useState(false);
  const [keyboardShortcutsOpen, setKeyboardShortcutsOpen] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressFocus, setCompressFocus] = useState("");

  /* ─── Settings persistence ─────────────────────────────────────────────── */

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(settingsKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        setEnabledTools(Array.isArray(parsed.enabledTools) ? parsed.enabledTools : []);
        setEnabledSkills(Array.isArray(parsed.enabledSkills) ? parsed.enabledSkills : []);
      }
    } catch {}
  }, [conversationId]);


  function persistAdvanced(next: { enabledTools: string[]; enabledSkills: string[] }) {
    setEnabledTools(next.enabledTools);
    setEnabledSkills(next.enabledSkills);
    if (typeof window !== "undefined") localStorage.setItem(settingsKey, JSON.stringify(next));
  }

  useEffect(() => {
    apiFetchSettings().then(d => {
      if (d.searchProvider === "tavily" || d.searchProvider === "duckduckgo") {
        setSearchProvider(d.searchProvider);
      }
    }).catch(() => {});
  }, []);

  function toggleSearchProvider() {
    setSearchProvider((prev) => {
      const next = prev === "tavily" ? "duckduckgo" : "tavily";
      apiSaveSettings({ searchProvider: next }).catch(() => {});
      return next;
    });
  }

  /* ─── Transport + useChat ──────────────────────────────────────────────── */

  const onFinishRef = useRef<(finish: ChatFinish) => void>(() => {});
  const onErrorRef = useRef<(err: Error) => void>(() => {});

  const chatTransport = useChatTransport({
    conversationId,
    conversation,
    selectedKbId,
    searchProvider,
    enabledTools,
    enabledSkills,
    mode,
    setIsCompressing,
    onFinishRef,
    onErrorRef,
  });

  const { messages, setMessages, sendMessage, status, stop, regenerate, error, addToolResult, isLoading } = chatTransport;

  /* ─── Data fetching ────────────────────────────────────────────────────── */

  const dataActions = useConversationData(conversationId, {
    conversation, input,
    setConversation, setMessages, setSelectedKbId, setContextData, setLoading,
    toast,
  });

  const {
    fetchConversation, refreshConversation, refreshConversationAndMessages,
    fetchContextUsage, handleModelSettingsSave, handleModelChange, handleWorkingFolderChange, handleKbToggle,
  } = dataActions;

  // After a compression, rebuild the chat from the saved conversation once it is idle, so the
  // summarized messages leave the view. Skips a snapshot that lacks the chat's newest message
  // (the refresh hasn't landed yet); it runs again when the next one does.
  useEffect(() => {
    if (isLoading || !conversation?.compressedAt || !conversation?.compressedSummary) return;
    if (messages[0]?.id === `compression-${new Date(conversation.compressedAt).getTime()}`) return;
    const lastId = messages[messages.length - 1]?.id;
    if (lastId && !conversation.messages?.some((m) => m.id === lastId)) return;
    setMessages(buildMessagesFromConversation(conversation as unknown as RawConversation) as unknown as typeof messages);
  }, [isLoading, conversation, messages, setMessages]);

  onFinishRef.current = useCallback((finish?: ChatFinish) => {
    refreshConversation().finally(() => setIsCompressing(false));
    fetchContextUsage();
    // `finish.messages` is the chat store's live array; the `messages` closure
    // is from the last render, which has not happened yet when onFinish runs.
    const all = finish?.messages ?? messages;
    const parts = (finish?.message?.parts ?? all[all.length - 1]?.parts ?? []) as any[];
    for (const p of parts) {
      const output = p.output || "";
      if (typeof output === "string" && (output.startsWith("Artifact created:") || output.startsWith("Artifact updated:"))) {
        const id = output.replace(/^Artifact (created|updated): /, "").split(" ")[0];
        setSelectedArtifactId(id);
        setArtifactPanelOpen(true);
      }
    }
    // Auto-consolidate memory every 10 messages, unless memory is off (temporary chats never save).
    if (!conversation?.temporary && !conversation?.memoryDisabled && all.length > 0 && all.length % 10 === 0) {
      fetch(`/api/memory/consolidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, model: conversation?.model }),
      }).catch(() => {});
    }
    // Suggest a next message from the last exchange; shown greyed in the box,
    // accepted with the arrow button or the → key.
    const exchange = finish?.isAbort ? null : lastExchange(all);
    if (!exchange) {
      if (!finish?.isAbort) console.debug("[suggest] skipped: no completed assistant turn to suggest from");
      return;
    }
    fetch(`/api/conversations/${conversationId}/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exchange),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (d?.suggestion) setSuggestion(d.suggestion);
        else console.warn("[suggest] no suggestion returned");
      })
      .catch((e) => console.warn("[suggest] request failed:", e?.message || e));
  }, [refreshConversation, fetchContextUsage, messages, setSelectedArtifactId, setArtifactPanelOpen, setIsCompressing, conversationId, conversation?.model, conversation?.temporary, conversation?.memoryDisabled]);

  onErrorRef.current = useCallback((err: Error) => {
    const msg = err?.message || String(err);
    toast(msg, "error");
    if (msg.includes("does not support tools") || (msg.includes("does not support") && msg.includes("tools")) ||
        msg.includes("model does not support") || (msg.includes("no") && msg.includes("tool support"))) {
      setToolErrorDialogOpen(true);
    }
  }, [toast]);

  /* ─── Initial fetches ──────────────────────────────────────────────────── */

  const [convLoaded, setConvLoaded] = useState(false);
  const autoSubmittedRef = useRef(false);

  useEffect(() => {
    fetchConversation().then(() => setConvLoaded(true));
    fetch("/api/seed", { method: "POST" }).catch(() => {});
  }, [conversationId]);
  useEffect(() => {
    if (!convLoaded || autoSubmittedRef.current) return;
    const prompt = initialPrompt;
    if (!prompt) return;
    autoSubmittedRef.current = true;
    setInput(prompt);
    setTimeout(() => {
      sendMessage({ parts: [{ type: "text" as const, text: prompt }] }).catch((e) =>
        console.error("auto-submit failed:", e),
      );
    }, 0);
  }, [convLoaded]);
  useEffect(() => { fetchContextUsage(); }, [conversationId, messages.length, conversation?.model]);
  useEffect(() => {
    function handleTitleUpdate(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail.id === conversationId) setConversation((prev) => (prev ? { ...prev, title: detail.title } : prev));
    }
    window.addEventListener("vas:title-updated", handleTitleUpdate);
    return () => window.removeEventListener("vas:title-updated", handleTitleUpdate);
  }, [conversationId]);

  /* ─── Temporary chat ───────────────────────────────────────────────────── */

  const temporaryRef = useRef(false);
  useEffect(() => { temporaryRef.current = !!conversation?.temporary; }, [conversation?.temporary]);
  useEffect(() => {
    // A remount of this chat (Strict Mode, Fast Refresh, Try again) means we never left.
    window.clearTimeout(pendingLeave.get(conversationId));
    pendingLeave.delete(conversationId);
    // Sidebar "New Chat" reloads the page, which skips cleanup, so it announces the leave first.
    function onLeaving() {
      if (!temporaryRef.current) return;
      temporaryRef.current = false;
      discardTemporaryChat(conversationId);
    }
    window.addEventListener("vas:leaving-chat", onLeaving);
    return () => {
      window.removeEventListener("vas:leaving-chat", onLeaving);
      if (!temporaryRef.current) return;
      pendingLeave.set(conversationId, window.setTimeout(() => {
        pendingLeave.delete(conversationId);
        discardTemporaryChat(conversationId);
      }, LEAVE_GRACE_MS));
    };
  }, [conversationId]);

  async function toggleTemporary() {
    if (!conversation) return;
    const next = !conversation.temporary;
    // Turning it off wins immediately: a leave before the PATCH lands must not delete the chat.
    if (!next) {
      temporaryRef.current = false;
      window.clearTimeout(pendingLeave.get(conversationId));
      pendingLeave.delete(conversationId);
    }
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temporary: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setConversation((prev) => (prev ? { ...prev, temporary: next } : prev));
      window.dispatchEvent(new CustomEvent("vas:temporary-changed", { detail: { id: conversationId, temporary: next } }));
    } catch (e) {
      console.error("Failed to toggle temporary chat:", e);
      toast("Couldn't update this chat", "error");
    }
  }

  /* ─── Message actions ──────────────────────────────────────────────────── */

  const msgActions = useMessageActions({
    conversationId, messages, setMessages, status, sendMessage, regenerate, addToolResult, toast,
    temporary: !!conversation?.temporary,
  });

  const {
    regenModal, setRegenModal,
    handleClarificationAnswer, handleEditMessage, handleDeleteMessage, handleCopyMessage, handleForkMessage,
    handleRegenerateMessage, handleRegenExecute,
  } = msgActions;

  /* ─── Quote cards ───────────────────────────────────────────────────────── */

  function addQuote(text: string) {
    setQuotes((prev) => [...prev, { id: `quote-${quoteSeq.current++}`, text, instruction: "" }]);
    // The no-break space makes the live region change, so a second quote is announced too.
    setAnnouncement((a) => (a === "Quote added" ? "Quote added\u00A0" : "Quote added"));
  }
  const updateQuote = (id: string, instruction: string) =>
    setQuotes((prev) => prev.map((q) => (q.id === id ? { ...q, instruction } : q)));
  const removeQuote = (id: string) => setQuotes((prev) => prev.filter((q) => q.id !== id));

  /** Cmd/Ctrl+Enter in a card: sends just that card; the rest of the composer stays. */
  async function sendQuote(id: string) {
    const quote = quotes.find((q) => q.id === id);
    if (!quote || isLoading) return;
    try {
      const sending = sendMessage({ parts: [{ type: "text" as const, text: composeQuoteMessage([quote], "") }] });
      setQuotes((prev) => prev.filter((q) => q.id !== quote.id));
      await sending;
    } catch (err) {
      console.error("[sendQuote] sendMessage failed:", err);
      toast("Failed to send message", "error");
      setQuotes((prev) => (prev.some((q) => q.id === quote.id) ? prev : [...prev, quote]));
    }
  }

  /* ─── Submit ────────────────────────────────────────────────────────────── */

  const windowTokens = contextData?.maxContextTokens || 8192;
  useEffect(() => {
    if (mentions.length === 0) return;
    let cancelled = false;
    (async () => {
      const cache = mentionTextRef.current;
      const keyOf = (path: string) => `${conversationId}|${workingFolder}|${path}`;
      // Only files picked since the last run are read.
      await Promise.all(
        mentions
          .filter((path) => !cache.has(keyOf(path)))
          .map(async (path) => cache.set(keyOf(path), await readMention(conversationId, path))),
      );
      const files = mentions.map((path) => ({ path, content: cache.get(keyOf(path)) ?? null }));
      const cuts = await cutFiles(files, budgetTokens(windowTokens, FILES_SHARE));
      if (cancelled) return;
      setMentionCuts(Object.fromEntries(cuts.filter((c) => c.cut).map((c) => [c.path, { kept: c.kept, total: c.total }])));
    })();
    return () => {
      cancelled = true;
    };
  }, [mentions, conversationId, workingFolder, windowTokens]);

  /** Sends the typed text, files and every quote card as one message. */
  async function sendComposed() {
    if (!input.trim() && files.length === 0 && mentions.length === 0 && quotes.length === 0) return;
    // Set before the first await, so a second Enter while files are read does nothing.
    if (isLoading || sendingRef.current) return;
    sendingRef.current = true;
    const sent = quotes;
    try {
      const fileBlocks = await composeFileBlocks(
        await Promise.all(mentions.map(async (path) => ({ path, content: await readMention(conversationId, path) }))),
        budgetTokens(windowTokens, FILES_SHARE),
      );
      const text = [composeQuoteMessage(sent, input), fileBlocks].filter(Boolean).join("\n\n");
      const { parts, attachments } = await buildMessageParts(text, files, conversation?.model);
      const sending = sendMessage({ parts }, { body: { attachments } });
      // The message is in the transcript now, so the cards have done their job.
      setQuotes((prev) => prev.filter((q) => !sent.some((s) => s.id === q.id)));
      await sending;
      setInput("");
      setFiles([]);
      setMentions([]);
      setSuggestion(null);
    } catch (err) {
      console.error("[handleSubmit] sendMessage failed:", err);
      toast("Failed to send message", "error");
      // Whatever didn't get sent stays: put back any card that was already cleared.
      setQuotes((prev) => [...sent.filter((s) => !prev.some((q) => q.id === s.id)), ...prev]);
    } finally {
      sendingRef.current = false;
    }
  }

  // Set synchronously, so a second Enter or Cmd+Enter before the first send reaches `status` is dropped.
  const submittingRef = useRef(false);

  async function handleSubmit(e?: { preventDefault(): void }) {
    e?.preventDefault();
    if (status === "streaming" || status === "submitted") {
      if (parseCommand(input)?.command.action === "compress") toast("Wait for the reply to finish, then compress", "info");
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    try { await submitInput(); } finally { submittingRef.current = false; }
  }

  async function submitInput() {
    if (!input.trim() && files.length === 0 && mentions.length === 0 && quotes.length === 0) return;
    const parsed = parseCommand(input);
    if (parsed) {
      const { command, arg } = parsed;
      if (missingArg(command, arg)) { toast(`Usage: ${command.usage}`, "info"); return; }
      setInput("");
      setFiles([]);
      setMentions([]);
      if (command.kind === "transform" && command.transform) {
        try { await sendMessage({ parts: [{ type: "text", text: command.transform(arg) }] }); }
        catch (err) { console.error("[handleSubmit] command sendMessage failed:", err); toast("Failed to send message", "error"); }
      } else {
        await runCommandAction(command, arg, {
          conversationId, conversation, sendMessage, setMessages, setConversation,
          setIsCompressing, setCompressFocus, setArtifactPanelOpen,
          setScratchpadOpen, setModelSettingsOpen, setKeyboardShortcutsOpen, toast, refreshConversationAndMessages,
        });
      }
      return;
    }

    await sendComposed();
  }

  /* ─── Dialog management ────────────────────────────────────────────────── */

  const isDialogOpen = useMemo(() =>
    scratchpadOpen || advancedOpen || modelSettingsOpen || contextPanelOpen ||
    toolErrorDialogOpen || artifactPanelOpen || todoPanelOpen || keyboardShortcutsOpen,
    [scratchpadOpen, advancedOpen, modelSettingsOpen, contextPanelOpen, toolErrorDialogOpen, artifactPanelOpen, todoPanelOpen, keyboardShortcutsOpen],
  );

  const closeTopDialog = useCallback(() => {
    if (keyboardShortcutsOpen) setKeyboardShortcutsOpen(false);
    else if (toolErrorDialogOpen) setToolErrorDialogOpen(false);
    else if (contextPanelOpen) setContextPanelOpen(false);
    else if (modelSettingsOpen) setModelSettingsOpen(false);
    else if (advancedOpen) setAdvancedOpen(false);
    else if (artifactPanelOpen) setArtifactPanelOpen(false);
    else if (todoPanelOpen) setTodoPanelOpen(false);
    else if (scratchpadOpen) setScratchpadOpen(false);
  }, [toolErrorDialogOpen, contextPanelOpen, modelSettingsOpen, advancedOpen, artifactPanelOpen, todoPanelOpen, scratchpadOpen, keyboardShortcutsOpen]);

  /* ─── Minimap ───────────────────────────────────────────────────────────── */

  const minimapMessagesRef = useRef<MinimapMessage[]>([]);
  const prevMinimapLen = useRef(0);
  const uniqueCount = useMemo(() => { const s = new Set<string>(); for (const m of messages) s.add(m.id); return s.size; }, [messages]);

  if (uniqueCount !== prevMinimapLen.current || minimapMessagesRef.current.length === 0) {
    prevMinimapLen.current = uniqueCount;
    const seen = new Set<string>();
    const result: MinimapMessage[] = [];
    for (const m of messages) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const text = ((m.parts || []) as any[]).filter((p: any) => p.type === "text").map((p: any) => p.text).join("");
      result.push({ id: m.id, role: m.role, preview: text.slice(0, 80) || (m.role === "user" ? "(file)" : "...") });
    }
    minimapMessagesRef.current = result;
  }
  const minimapMessages = minimapMessagesRef.current;
  const currentModelName = conversation?.model?.split("/")?.pop() || conversation?.model || "";

  /* ─── Return ────────────────────────────────────────────────────────────── */

  return {
    conversation, setConversation, loading, setLoading,
    input, setInput, files, setFiles, mentions, setMentions, mentionCuts, suggestion, setSuggestion,
    quotes, addQuote, updateQuote, removeQuote, sendQuote, sendComposed, announcement,
    toggleTemporary,
    scratchpadOpen, setScratchpadOpen,
    todoPanelOpen, setTodoPanelOpen,
    advancedOpen, setAdvancedOpen,
    modelSettingsOpen, setModelSettingsOpen,
    artifactPanelOpen, setArtifactPanelOpen, selectedArtifactId, setSelectedArtifactId,
    contextPanelOpen, setContextPanelOpen, contextData, setContextData,
    toolErrorDialogOpen, setToolErrorDialogOpen,
    keyboardShortcutsOpen, setKeyboardShortcutsOpen,
    isCompressing, setIsCompressing, compressFocus,
    searchProvider, toggleSearchProvider,
    enabledTools, enabledSkills, persistAdvanced,
    selectedKbId, setSelectedKbId,
    scrollRef, toast,
    messages, sendMessage, status, stop, regenerate, error, setMessages, addToolResult,
    isLoading, currentModelName,
    fetchConversation, refreshConversation, refreshConversationAndMessages,
    fetchContextUsage, handleModelSettingsSave, handleModelChange, handleWorkingFolderChange, handleKbToggle,
    handleClarificationAnswer, handleEditMessage, handleDeleteMessage, handleCopyMessage, handleForkMessage,
    handleRegenerateMessage, handleRegenExecute, regenModal, setRegenModal,
    handleSubmit,
    minimapMessages,
    isDialogOpen, closeTopDialog,
  };
}
