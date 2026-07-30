"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useToast } from "@/app/components/Toast";
import type { Conversation } from "@/app/components/conversation/types";
import type { MinimapMessage } from "@/app/components/MinimapNavigator";
import { parseCommand } from "@/lib/commands";
import { buildMessageParts } from "@/lib/utils/messageParts";

import { fetchSettings as apiFetchSettings, saveSettings as apiSaveSettings } from "@/app/hooks/useSettingsApi";
import { runCommandAction } from "./runCommandAction";
import { useConversationData } from "./useConversationData";
import { useChatTransport } from "./useChatTransport";
import { useMessageActions } from "./useMessageActions";
import type { ConversationPageState } from "./types";

export type { ConversationPageState };

export function useConversationPage(conversationId: string, initialPrompt?: string): ConversationPageState {
  const { toast } = useToast();

  /* ─── State ────────────────────────────────────────────────────────────── */

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedKbId, setSelectedKbId] = useState<string>("");
  const [scratchpadOpen, setScratchpadOpen] = useState(false);
  const [goalPanelOpen, setGoalPanelOpen] = useState(false);
  const [goalKickoff, setGoalKickoff] = useState<{ objective: string; nonce: number }>({ objective: "", nonce: 0 });
  const [todoPanelOpen, setTodoPanelOpen] = useState(false);
  const [searchProvider, setSearchProvider] = useState<"duckduckgo" | "tavily">("duckduckgo");
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

  const onFinishRef = useRef<() => void>(() => {});
  const onErrorRef = useRef<(err: Error) => void>(() => {});

  const chatTransport = useChatTransport({
    conversationId,
    conversation,
    selectedKbId,
    searchProvider,
    enabledTools,
    enabledSkills,
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
    fetchContextUsage, handleModelSettingsSave, handleModelChange, handleKbToggle,
  } = dataActions;

  onFinishRef.current = useCallback(() => {
    refreshConversation().finally(() => setIsCompressing(false));
    fetchContextUsage();
    const parts = (messages[messages.length - 1]?.parts || []) as any[];
    for (const p of parts) {
      const output = p.output || "";
      if (typeof output === "string" && (output.startsWith("Artifact created:") || output.startsWith("Artifact updated:"))) {
        const id = output.replace(/^Artifact (created|updated): /, "").split(" ")[0];
        setSelectedArtifactId(id);
        setArtifactPanelOpen(true);
      }
    }
    // Auto-consolidate memory every 10 messages
    if (messages.length > 0 && messages.length % 10 === 0) {
      fetch(`/api/memory/consolidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, model: conversation?.model }),
      }).catch(() => {});
    }
  }, [refreshConversation, fetchContextUsage, messages, setSelectedArtifactId, setArtifactPanelOpen, setIsCompressing, conversationId, conversation?.model]);

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

  /* ─── Message actions ──────────────────────────────────────────────────── */

  const msgActions = useMessageActions({
    conversationId, messages, setMessages, status, sendMessage, regenerate, addToolResult, toast,
  });

  const {
    regenModal, setRegenModal,
    handleClarificationAnswer, handleEditMessage, handleDeleteMessage, handleCopyMessage,
    handleRegenerate, handleRegenerateMessage, handleRegenExecute,
  } = msgActions;

  /* ─── Submit ────────────────────────────────────────────────────────────── */

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!input.trim() && files.length === 0) return;
    if (status === "streaming" || status === "submitted") return;

    const parsed = parseCommand(input);
    if (parsed) {
      const { command, arg } = parsed;
      if (command.requiresArg && !arg.trim()) { toast(`Usage: ${command.usage}`, "info"); return; }
      setInput("");
      setFiles([]);
      if (command.kind === "transform" && command.transform) {
        try { await sendMessage({ parts: [{ type: "text", text: command.transform(arg) }] }); }
        catch (err) { console.error("[handleSubmit] command sendMessage failed:", err); toast("Failed to send message", "error"); }
      } else {
        await runCommandAction(command, arg, {
          conversationId, conversation, sendMessage, setMessages, setConversation,
          setGoalPanelOpen, setGoalKickoff, setIsCompressing, setArtifactPanelOpen,
          setScratchpadOpen, setModelSettingsOpen, toast, refreshConversationAndMessages,
        });
      }
      return;
    }

    const { parts, attachments } = await buildMessageParts(input, files, conversation?.model);
    try { await sendMessage({ parts }, { body: { attachments } }); }
    catch (err) { console.error("[handleSubmit] sendMessage failed:", err); toast("Failed to send message", "error"); }
    finally { setInput(""); setFiles([]); }
  }

  /* ─── Dialog management ────────────────────────────────────────────────── */

  const isDialogOpen = useMemo(() =>
    scratchpadOpen || advancedOpen || modelSettingsOpen || contextPanelOpen ||
    toolErrorDialogOpen || artifactPanelOpen || goalPanelOpen || todoPanelOpen || keyboardShortcutsOpen,
    [scratchpadOpen, advancedOpen, modelSettingsOpen, contextPanelOpen, toolErrorDialogOpen, artifactPanelOpen, goalPanelOpen, todoPanelOpen, keyboardShortcutsOpen],
  );

  const closeTopDialog = useCallback(() => {
    if (toolErrorDialogOpen) setToolErrorDialogOpen(false);
    else if (contextPanelOpen) setContextPanelOpen(false);
    else if (modelSettingsOpen) setModelSettingsOpen(false);
    else if (advancedOpen) setAdvancedOpen(false);
    else if (goalPanelOpen) setGoalPanelOpen(false);
    else if (artifactPanelOpen) setArtifactPanelOpen(false);
    else if (todoPanelOpen) setTodoPanelOpen(false);
    else if (scratchpadOpen) setScratchpadOpen(false);
  }, [toolErrorDialogOpen, contextPanelOpen, modelSettingsOpen, advancedOpen, goalPanelOpen, artifactPanelOpen, todoPanelOpen, scratchpadOpen]);

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
    input, setInput, files, setFiles,
    scratchpadOpen, setScratchpadOpen,
    goalPanelOpen, setGoalPanelOpen, goalKickoff, setGoalKickoff,
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
    selectedKbId, setSelectedKbId,
    scrollRef, toast,
    messages, sendMessage, status, stop, regenerate, error, setMessages, addToolResult,
    isLoading, currentModelName,
    fetchConversation, refreshConversation, refreshConversationAndMessages,
    fetchContextUsage, handleModelSettingsSave, handleModelChange, handleKbToggle,
    handleClarificationAnswer, handleEditMessage, handleDeleteMessage, handleCopyMessage,
    handleRegenerate, handleRegenerateMessage, handleRegenExecute, regenModal, setRegenModal,
    handleSubmit,
    minimapMessages,
    isDialogOpen, closeTopDialog,
  };
}
