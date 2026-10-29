"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useToast } from "@/app/components/Toast";
import { fetchModels } from "@/app/hooks/useModelsApi";
import type { Conversation, ModelInfo } from "@/app/components/conversation/types";
import { useChatMode } from "@/app/contexts/ChatModeContext";
import type { ApprovalAnswer, PlanAnswer } from "@/app/components/ToolAnswers";
import type { MinimapMessage } from "@/app/components/MinimapNavigator";
import { parseCommand, missingArg } from "@/lib/commands";
import {
  ALLOWED_FOR_CHAT, DENIED_BY_USER, approvalTitle, buildMessageParts, denyOpenApprovals, waitingPlanCallId,
  type PlanDecision,
} from "@/lib/utils/messageParts";
import { isCliModelId } from "@/lib/providers";
import { buildMessagesFromConversation, lastExchange, type RawConversation } from "@/lib/utils/conversation";
import { composeQuoteMessage, type QuoteCard } from "@/lib/utils/quoteReply";

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

function discardTemporaryChat(id: string) {
  // keepalive lets the request outlive the page on a full reload; ?temporary=1 means the server
  // never deletes a chat that stopped being temporary.
  fetch(`/api/conversations/${id}?temporary=1`, { method: "DELETE", keepalive: true }).catch(() => {});
}

/** Tools allowed for one chat in Ask mode (`vas:allow:<id>`). Unreadable storage means none. */
function readAllowedTools(chatId: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(`vas:allow:${chatId}`) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function useConversationPage(conversationId: string, initialPrompt?: string): ConversationPageState {
  const { toast } = useToast();

  /* ─── State ────────────────────────────────────────────────────────────── */

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
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
  const { mode, setMode, setModelCaps } = useChatMode();
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const settingsKey = `vas:advancedSettings:${conversationId}`;
  // Tools the user allowed for this chat in Ask mode ("Allow for this chat"), kept in the browser.
  const [allowedState, setAllowedState] = useState<{ chat: string; tools: string[] } | null>(null);
  const allowedTools = useMemo(
    () => (allowedState?.chat === conversationId ? allowedState.tools : readAllowedTools(conversationId)),
    [allowedState, conversationId],
  );
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
    allowedTools,
    setIsCompressing,
    onFinishRef,
    onErrorRef,
  });

  const { messages, setMessages, sendMessage, status, stop, regenerate, error, addToolResult, addToolApprovalResponse, setRequestBody, isLoading } = chatTransport;

  /* ─── Ask and Plan answers ─────────────────────────────────────────────── */

  useEffect(() => {
    fetchModels().then(setModelList).catch(() => {});
  }, []);
  // Until the list loads, assume tools: the server still decides by the model's real support.
  const toolsAvailable = !conversation?.chatOnlyMode && modelList.find((m) => m.id === conversation?.model)?.supportsTools !== false;
  const modelLabel = conversation?.model?.split("/")?.pop() || conversation?.model || "";

  // The mode switch reads these to disable Ask and Agent, and to label Ask for CLI models.
  useEffect(() => {
    setModelCaps({ toolsAvailable, cli: isCliModelId(conversation?.model ?? "") });
  }, [toolsAvailable, conversation?.model, setModelCaps]);

  // A model without tools can't run Ask or Agent: fall back to Chat and say so (UX 2.6).
  useEffect(() => {
    if (toolsAvailable || (mode !== "ask" && mode !== "agent")) return;
    setMode("chat");
    setRequestBody({ mode: "chat" });
    toast(`Switched to Chat: ${modelLabel} can't use tools`, "info");
  }, [toolsAvailable, mode]);

  /** Clears "Allow for this chat" for this chat, so Ask mode asks again. */
  function resetAllowedTools() {
    setAllowedState({ chat: conversationId, tools: [] });
    setRequestBody({ allowedTools: [] });
    try { localStorage.removeItem(`vas:allow:${conversationId}`); } catch {}
    toast("Ask mode will ask again", "info");
  }


  // Keys already answered (approval ids, plan call ids). A double click, or a click after Stop, finds its key taken.
  const answeredRef = useRef(new Set<string>());
  function claim(key: string): boolean {
    if (answeredRef.current.has(key)) return false;
    answeredRef.current.add(key);
    return true;
  }

  /** Allow or Deny a waiting tool call. "Allow for this chat" is remembered for the rest of the chat. */
  function answerApproval({ approvalId, toolName, approved, allowForChat }: ApprovalAnswer) {
    if (!claim(approvalId)) return;
    if (approved && allowForChat && !allowedTools.includes(toolName)) {
      const next = [...allowedTools, toolName];
      setAllowedState({ chat: conversationId, tools: next });
      setRequestBody({ allowedTools: next });
      try { localStorage.setItem(`vas:allow:${conversationId}`, JSON.stringify(next)); } catch {}
    }
    addToolApprovalResponse({
      id: approvalId,
      approved,
      reason: approved ? (allowForChat ? ALLOWED_FOR_CHAT : undefined) : DENIED_BY_USER,
    });
  }

  /** Approve on a reply with no plan card, from a model without tools: send the plan request on. */
  function approvePlanReply() {
    if (isLoading || !claim(`plan-reply:${messages.length}`)) return;
    setRequestBody({ mode: "chat" });
    setMode("chat");
    sendMessage({ parts: [{ type: "text", text: "Approved. Carry out the plan." }] }).catch((e) =>
      console.error("[approve plan] sendMessage failed:", e),
    );
  }

  /** Approve runs the plan in Ask or Agent, and says so in a visible message. Revise sends the feedback
   *  and the model plans again, with no message of its own. */
  function answerPlan({ toolCallId, approve, mode: runIn, feedback }: PlanAnswer) {
    if (!claim(toolCallId)) return;
    if (approve) {
      // The mode goes out with the request, so it is set before the result is added and the message sent.
      const next = runIn ?? "ask";
      setRequestBody({ mode: next });
      setMode(next);
      const decision: PlanDecision = { action: "approve", mode: next };
      addToolResult({ tool: "presentPlan", toolCallId, output: decision });
      sendMessage({ parts: [{ type: "text", text: "Approved. Run the plan." }] }).catch((e) =>
        console.error("[approve plan] sendMessage failed:", e),
      );
    } else {
      const decision: PlanDecision = { action: "revise", feedback: feedback ?? "" };
      addToolResult({ tool: "presentPlan", toolCallId, output: decision });
    }
  }

  /** Stop: a card still open is denied in the transcript and its id is claimed, so Allow can't run it. */
  function stopReply() {
    for (const m of messages) {
      for (const p of (m.parts ?? []) as any[]) {
        if (p?.state === "approval-requested" && p.approval?.id) answeredRef.current.add(p.approval.id);
      }
    }
    setMessages((prev) =>
      prev.map((m) => (m.parts?.some((p: any) => p?.state === "approval-requested") ? { ...m, parts: denyOpenApprovals(m.parts as any[]) } : m)) as typeof prev,
    );
    stop();
  }

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
    // A card that just appeared is announced once, in the pane's live region (UX 2.5).
    if (!finish?.isAbort) {
      const card = parts.find((p) => p?.state === "approval-requested");
      if (card) setAnnouncement(`Needs your OK: ${approvalTitle(String(card.type).replace(/^tool-/, ""), card.input)}`);
      else if (parts.some((p) => p?.type === "tool-presentPlan" && p.state === "input-available")) setAnnouncement("Plan ready");
    }
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
  });

  const {
    regenModal, setRegenModal,
    handleClarificationAnswer, handleEditMessage, handleDeleteMessage, handleCopyMessage,
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

  /** Sends the typed text, files and every quote card as one message. */
  async function sendComposed() {
    if (!input.trim() && files.length === 0 && quotes.length === 0) return;
    if (isLoading) return;
    const sent = quotes;
    try {
      const { parts, attachments } = await buildMessageParts(composeQuoteMessage(sent, input), files, conversation?.model);
      const sending = sendMessage({ parts }, { body: { attachments } });
      // The message is in the transcript now, so the cards have done their job.
      setQuotes((prev) => prev.filter((q) => !sent.some((s) => s.id === q.id)));
      await sending;
      setInput("");
      setFiles([]);
      setSuggestion(null);
    } catch (err) {
      console.error("[handleSubmit] sendMessage failed:", err);
      toast("Failed to send message", "error");
      // Whatever didn't get sent stays: put back any card that was already cleared.
      setQuotes((prev) => [...sent.filter((s) => !prev.some((q) => q.id === s.id)), ...prev]);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!input.trim() && files.length === 0 && quotes.length === 0) return;
    if (status === "streaming" || status === "submitted") return;

    const parsed = parseCommand(input);
    if (parsed) {
      const { command, arg } = parsed;
      if (missingArg(command, arg)) { toast(`Usage: ${command.usage}`, "info"); return; }
      setInput("");
      setFiles([]);
      if (command.kind === "transform" && command.transform) {
        try { await sendMessage({ parts: [{ type: "text", text: command.transform(arg) }] }); }
        catch (err) { console.error("[handleSubmit] command sendMessage failed:", err); toast("Failed to send message", "error"); }
      } else {
        await runCommandAction(command, arg, {
          conversationId, conversation, sendMessage, setMessages, setConversation,
          setIsCompressing, setArtifactPanelOpen,
          setScratchpadOpen, setModelSettingsOpen, setKeyboardShortcutsOpen, toast, refreshConversationAndMessages,
          setMode, setRequestBody, toolsAvailable,
        });
      }
      return;
    }

    // A plan card still waiting: typed text is its Revise feedback, not a new message.
    const waitingPlan = waitingPlanCallId(messages);
    if (waitingPlan && input.trim() && files.length === 0 && quotes.length === 0) {
      answerPlan({ toolCallId: waitingPlan, approve: false, feedback: input.trim() });
      setInput("");
      setSuggestion(null);
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
    if (toolErrorDialogOpen) setToolErrorDialogOpen(false);
    else if (contextPanelOpen) setContextPanelOpen(false);
    else if (modelSettingsOpen) setModelSettingsOpen(false);
    else if (advancedOpen) setAdvancedOpen(false);
    else if (artifactPanelOpen) setArtifactPanelOpen(false);
    else if (todoPanelOpen) setTodoPanelOpen(false);
    else if (scratchpadOpen) setScratchpadOpen(false);
  }, [toolErrorDialogOpen, contextPanelOpen, modelSettingsOpen, advancedOpen, artifactPanelOpen, todoPanelOpen, scratchpadOpen]);

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
    input, setInput, files, setFiles, suggestion, setSuggestion,
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
    isCompressing, setIsCompressing,
    searchProvider, toggleSearchProvider,
    enabledTools, enabledSkills, persistAdvanced,
    answerApproval, answerPlan, approvePlanReply, toolsAvailable, mode,
    allowedToolCount: allowedTools.length, resetAllowedTools,
    selectedKbId, setSelectedKbId,
    scrollRef, toast,
    messages, sendMessage, status, stop: stopReply, regenerate, error, setMessages, addToolResult,
    isLoading, currentModelName,
    fetchConversation, refreshConversation, refreshConversationAndMessages,
    fetchContextUsage, handleModelSettingsSave, handleModelChange, handleWorkingFolderChange, handleKbToggle,
    handleClarificationAnswer, handleEditMessage, handleDeleteMessage, handleCopyMessage,
    handleRegenerateMessage, handleRegenExecute, regenModal, setRegenModal,
    handleSubmit,
    minimapMessages,
    isDialogOpen, closeTopDialog,
  };
}
