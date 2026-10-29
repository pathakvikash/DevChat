"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { generateId, type UIMessage } from "ai";
import { useToast } from "@/app/components/Toast";
import type { QueuedItem } from "@/app/components/QueuedMessages";
import { fetchModels } from "@/app/hooks/useModelsApi";
import type { Conversation, ModelInfo } from "@/app/components/conversation/types";
import { useConversationMode, type ModelCaps } from "@/app/contexts/ChatModeContext";
import { useSplitViewOptional } from "@/app/c/SplitViewContext";
import { buildAgentMessagePart, type AgentMessageData } from "@/lib/chat/agentMessages";
import { AGENT_DELIVERED, AGENT_NOT_OPEN } from "@/lib/utils/agentLink";
import { takeSideQuestion } from "@/lib/sideChat";
import { useKeyboardShortcuts } from "@/app/hooks/useKeyboardShortcuts";
import type { ApprovalAnswer, PlanAnswer } from "@/app/components/ToolAnswers";
import type { MinimapMessage } from "@/app/components/MinimapNavigator";
import { parseCommand, missingArg } from "@/lib/commands";
import {
  ALLOWED_FOR_CHAT, DENIED_BY_USER, approvalTitle, buildMessageParts, denyOpenApprovals, shouldAutoContinue,
  waitingPlanCallId, type AnyPart, type PlanDecision,
} from "@/lib/utils/messageParts";
import { buildMessagesFromConversation, lastExchange, type RawConversation } from "@/lib/utils/conversation";
import { composeQuoteMessage, type QuoteCard } from "@/lib/utils/quoteReply";
import { composeFileBlocks, cutFiles } from "@/lib/utils/fileMentions";
import { budgetTokens } from "@/lib/chat/contextBudget";

import { runCommandAction } from "./runCommandAction";
import { useConversationData } from "./useConversationData";
import { useChatTransport, type ChatFinish } from "./useChatTransport";
import { useMessageActions } from "./useMessageActions";
import type { ChatPaneState } from "./types";

export type { ChatPaneState };

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

/** Ids of the queued messages a reply already shows, from its `data-queued-message` parts. */
function deliveredQueueIds(messages: UIMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) {
    for (const p of (m.parts ?? []) as any[]) {
      if (p.type === "data-queued-message") ids.add(p.data?.queuedId);
    }
  }
  return ids;
}

const queueHeaders = { "Content-Type": "application/json" };

/** A queued message the server never took: its text, and its sender when it came from another chat. */
type Leftover = { text: string; agent?: AgentMessageData };

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

export interface ChatPaneOptions {
  /** Only a focused pane answers keyboard shortcuts. */
  focused: boolean;
  /** "side" skips suggestions, memory consolidation and artifact auto-open. */
  kind: "chat" | "side";
  searchProvider: "duckduckgo" | "tavily";
  /** `?q=`: sent once, after the chat loads. */
  initialPrompt?: string;
}

export function useChatPane(conversationId: string, { focused, kind, searchProvider, initialPrompt }: ChatPaneOptions): ChatPaneState {
  const { toast } = useToast();
  const split = useSplitViewOptional();
  // A pane that has unmounted must not send the queue it left behind; the server keeps those messages.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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
  const { mode: storedMode, setMode: storeMode } = useConversationMode(conversationId);
  // A side chat is always chat mode (the server forces it too), and its mode is not stored.
  const isSide = kind === "side" || conversation?.kind === "side";
  const mode = isSide ? "chat" : storedMode;
  const setMode = isSide ? () => {} : storeMode;
  const [modelCaps, setModelCaps] = useState<ModelCaps>({ toolsAvailable: true });
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const settingsKey = `vas:advancedSettings:${conversationId}`;
  // Tools the user allowed for this chat in Ask mode ("Allow for this chat"), kept in the browser.
  const [allowedState, setAllowedState] = useState<{ chat: string; tools: string[] } | null>(null);
  const allowedTools = useMemo(
    () => (allowedState?.chat === conversationId ? allowedState.tools : readAllowedTools(conversationId)),
    [allowedState, conversationId],
  );
  // Allowed tools belong to one folder: a folder change starts the list again (render-time adjust, as mentions do).
  const [allowedFolder, setAllowedFolder] = useState(workingFolder);
  if (allowedFolder !== workingFolder) {
    setAllowedFolder(workingFolder);
    setAllowedState(null);
  }
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

  /* ─── Transport + useChat ──────────────────────────────────────────────── */

  const onFinishRef = useRef<(finish: ChatFinish) => void>(() => {});
  const onErrorRef = useRef<(err: Error) => void>(() => {});
  const onQueuedDeliveredRef = useRef<(queuedId: string) => void>(() => {});
  const onSendToChatRef = useRef<(input: { to: string; message: string }) => Promise<string>>(async () => AGENT_NOT_OPEN);
  // The other open chat panes, sent with each request (the model is told which chats it can message).
  const openPanes = useMemo(() => (split?.chatPanes ?? []).filter((p) => p.id !== conversationId), [split?.chatPanes, conversationId]);

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
    onQueuedDeliveredRef,
    openPanes,
    onSendToChatRef,
  });

  const { messages, setMessages, sendMessage: chatSend, status, stop: stopStream, regenerate, error, addToolResult, addToolApprovalResponse, setRequestBody, isLoading } = chatTransport;
  const isSubagent = conversation?.kind === "subagent";
  // A user's own send starts this pane's agent count again. Agent messages go through chatSend directly.
  const sendMessage = (...args: Parameters<typeof chatSend>) => {
    split?.resetHop(conversationId);
    return chatSend(...args);
  };

  /* ─── Message queue ────────────────────────────────────────────────────── */

  const [queue, setQueue] = useState<QueuedItem[]>([]);
  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  // Each chip's POST. Edits, removals and take-backs wait for it, so no request reaches a row that does not exist yet.
  const postsRef = useRef(new Map<string, Promise<void>>());
  const seqRef = useRef(0);
  // Chips queued in this page; only their delivery is announced.
  const knownRef = useRef(new Set<string>());
  const queuedUrl = `/api/conversations/${conversationId}/queue`;
  const delivered = deliveredQueueIds(messages);
  const queued = queue.filter((q) => !delivered.has(q.id));

  useEffect(() => {
    onQueuedDeliveredRef.current = (id) => {
      if (knownRef.current.has(id)) setAnnouncement((a) => (a === "Queued message delivered" ? `${a} ` : "Queued message delivered"));
    };
  });

  function setQueued(id: string, change: Partial<QueuedItem> | null) {
    setQueue((prev) =>
      change ? prev.map((q) => (q.id === id ? { ...q, ...change } : q)) : prev.filter((q) => q.id !== id),
    );
  }

  /** POSTs a chip. If the POST fails the chip stays on this page as "Not queued". */
  function postQueued(item: QueuedItem): Promise<void> {
    const run = (async () => {
      try {
        const res = await fetch(queuedUrl, {
          method: "POST",
          headers: queueHeaders,
          body: JSON.stringify({ id: item.id, text: item.text, seq: item.seq, ...(item.agent ? { agent: item.agent } : {}) }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setQueued(item.id, { status: "queued" });
      } catch {
        setQueued(item.id, { status: "failed" });
      }
    })();
    postsRef.current.set(item.id, run);
    return run;
  }

  /** Enter or Queue while a reply runs: the message becomes a chip until a step takes it. */
  function queueMessage() {
    const text = composeQuoteMessage(quotes, input).trim();
    if (!text) return;
    const command = parseCommand(input)?.command.action;
    if (command) {
      // Enter while a reply runs goes here, not to handleSubmit, so the /compress wording lives here too.
      toast(command === "compress" ? "Wait for the reply to finish, then compress" : "Wait for the reply to finish, then run the command", "info");
      return;
    }
    const item: QueuedItem = { id: generateId(), seq: ++seqRef.current, text, status: "queued" };
    knownRef.current.add(item.id);
    setQueue((prev) => [...prev, item]);
    setInput("");
    setQuotes([]);
    setAnnouncement((a) => (a === "Message queued" ? "Message queued " : "Message queued"));
    void postQueued(item);
  }

  /** An agent message that arrives while this chat replies: it joins the queue with its sender's badge. */
  function queueAgent(text: string, agent: AgentMessageData) {
    const item: QueuedItem = { id: generateId(), seq: ++seqRef.current, text, status: "queued", agent };
    knownRef.current.add(item.id);
    setQueue((prev) => [...prev, item]);
    void postQueued(item);
  }

  /** Stop all: this chat's queued agent messages go; the user's own typed messages stay. */
  function dropAgentQueued() {
    for (const q of queueRef.current) {
      if (q.agent && q.status !== "claimed") void removeQueued(q.id);
    }
  }

  async function editQueued(id: string, text: string) {
    const item = queueRef.current.find((q) => q.id === id);
    if (!item || item.status === "claimed") return;
    // Never stored: the edit stays on this page.
    if (item.status === "failed") {
      setQueued(id, { text });
      return;
    }
    setQueued(id, { text, saving: true });
    try {
      await postsRef.current.get(id);
      const res = await fetch(queuedUrl, {
        method: "PATCH",
        headers: queueHeaders,
        body: JSON.stringify({ id, text }),
      });
      if (res.status === 409) setQueued(id, { status: "claimed", text: item.text, saving: false });
      else if (res.status === 404) setQueued(id, { status: "failed", saving: false });
      else if (!res.ok) throw new Error(String(res.status));
      else setQueued(id, { saving: false });
    } catch {
      setQueued(id, { text: item.text, saving: false });
      toast("Couldn't edit the queued message", "error");
    }
  }

  async function removeQueued(id: string) {
    const item = queueRef.current.find((q) => q.id === id);
    if (!item || item.status === "claimed") return;
    try {
      await postsRef.current.get(id);
      const res = await fetch(`${queuedUrl}?qid=${encodeURIComponent(id)}`, { method: "DELETE" });
      // In flight: a step has taken it, so it stays until its marker shows.
      if (res.status === 409) setQueued(id, { status: "claimed" });
      else if (res.ok || res.status === 404) setQueued(id, null);
      else throw new Error(String(res.status));
    } catch {
      toast("Couldn't remove the queued message", "error");
    }
  }

  function retryQueued(id: string) {
    const item = queueRef.current.find((q) => q.id === id);
    if (!item) return;
    setQueued(id, { status: "queued" });
    void postQueued({ ...item, status: "queued" });
  }

  /** DELETEs each row and returns the ones that are now ours. A row the server no longer has (taken, or in a
   *  step's claim) is dropped; a row never stored keeps its text. */
  async function takeRows(rows: { id: string; text: string; stored: boolean; agent?: AgentMessageData }[]): Promise<Leftover[]> {
    const taken = await Promise.all(
      rows.map(async (row): Promise<Leftover | null> => {
        const mine = { text: row.text, agent: row.agent };
        if (!row.stored) return mine;
        try {
          const res = await fetch(`${queuedUrl}?qid=${encodeURIComponent(row.id)}`, { method: "DELETE" });
          return res.ok ? mine : null;
        } catch {
          return mine;
        }
      }),
    );
    return taken.filter((t): t is Leftover => t !== null);
  }

  /** After the stream closes: waits for the POSTs, re-reads the queue and takes what is still undelivered. */
  async function takeLeftovers(all: UIMessage[]): Promise<Leftover[]> {
    await Promise.all([...postsRef.current.values()]);
    const shown = deliveredQueueIds(all);
    const res = await fetch(queuedUrl);
    if (!res.ok) throw new Error(String(res.status));
    const stored: { id: string; text: string; seq: number; agent?: AgentMessageData }[] = (await res.json()).queued ?? [];
    const storedIds = new Set(stored.map((s) => s.id));
    const unstored = queueRef.current.filter((q) => q.status === "failed" && !storedIds.has(q.id) && !shown.has(q.id));
    const rows = [
      ...stored.map((s) => ({ ...s, agent: queueRef.current.find((q) => q.id === s.id)?.agent ?? s.agent, stored: true })),
      ...unstored.map((q) => ({ id: q.id, text: q.text, seq: q.seq, agent: q.agent, stored: false })),
    ].sort((a, b) => a.seq - b.seq);
    const taken = await takeRows(rows);
    const ours = new Set(rows.map((r) => r.id));
    setQueue((prev) => prev.filter((q) => !ours.has(q.id) && !shown.has(q.id)));
    return taken;
  }

  /** Texts go back into the input box, ahead of any text already there. */
  function restoreInput(texts: string[]) {
    if (texts.length) setInput((prev) => [...texts, prev].filter(Boolean).join("\n\n"));
  }

  /** Texts go out together as the next message, once the chat is idle. */
  function sendNext(texts: string[]) {
    if (!texts.length) return;
    // After onFinish the chat is not yet idle, so the send waits a tick (as the auto-submit does).
    setTimeout(() => {
      sendMessage({ parts: [{ type: "text" as const, text: texts.join("\n\n") }] }).catch((err: unknown) => {
        console.error("[queue] sending queued messages failed:", err);
        toast("Failed to send message", "error");
      });
    }, 0);
  }

  /** A leftover agent message goes out as an agent message again, with its sender and hop. One turn at a
   *  time: any others go back into the input box as text. */
  function sendAgentNext(items: Leftover[]) {
    const [first, ...rest] = items;
    restoreInput(rest.map((r) => r.text));
    if (!first?.agent) return;
    setTimeout(() => {
      chatSend({ parts: [buildAgentMessagePart(first.agent!), { type: "text" as const, text: first.text }] }).catch((err: unknown) =>
        console.error("[agent] sending a queued agent message failed:", err),
      );
    }, 0);
  }

  /** Stop ends the stream; onFinish then puts the undelivered messages back into the input box. */
  function stop() {
    stopStream();
  }

  /* ─── Ask and Plan answers ─────────────────────────────────────────────── */

  useEffect(() => {
    fetchModels().then(setModelList).catch(() => {});
  }, []);
  // Until the list loads, assume tools: the server still decides by the model's real support.
  const toolsAvailable = !conversation?.chatOnlyMode && modelList.find((m) => m.id === conversation?.model)?.supportsTools !== false;
  const modelLabel = conversation?.model?.split("/")?.pop() || conversation?.model || "";

  // The mode switch reads these to disable Ask and Agent, and to label Ask for CLI models.
  useEffect(() => {
    setModelCaps({ toolsAvailable });
  }, [toolsAvailable, setModelCaps]);

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
    // Queued messages still waiting: after a Stop or an error they go back to the input; after a normal end
    // they go out as the next message. A reply that auto-continues keeps them.
    if (mountedRef.current && queueRef.current.length && !(finish?.message && shouldAutoContinue(finish.message.parts as AnyPart[]))) {
      const stopped = !!(finish?.isAbort || finish?.isError);
      takeLeftovers(all)
        .then((rest) => {
          const own = rest.filter((r) => !r.agent);
          // A stop drops the agent messages (the user did not write them); otherwise they go out as agent messages.
          if (stopped) return restoreInput(own.map((r) => r.text));
          const agents = rest.filter((r) => r.agent);
          if (agents.length) {
            sendAgentNext(agents);
            restoreInput(own.map((r) => r.text));
          } else sendNext(own.map((r) => r.text));
        })
        .catch(() => toast("Couldn't restore queued messages. Reload to see them.", "error"));
    }
    // The reply is over: if the other pane of its agent exchange is idle too, the exchange ends.
    split?.agentIdle(conversationId);
    const parts = (finish?.message?.parts ?? all[all.length - 1]?.parts ?? []) as any[];
    // A card that just appeared is announced once, in the pane's live region (UX 2.5).
    if (!finish?.isAbort) {
      const card = parts.find((p) => p?.state === "approval-requested");
      if (card) setAnnouncement(`Needs your OK: ${approvalTitle(String(card.type).replace(/^tool-/, ""), card.input)}`);
      else if (parts.some((p) => p?.type === "tool-presentPlan" && p.state === "input-available")) setAnnouncement("Plan ready");
    }
    for (const p of isSide ? [] : parts) {
      const output = p.output || "";
      if (typeof output === "string" && (output.startsWith("Artifact created:") || output.startsWith("Artifact updated:"))) {
        const id = output.replace(/^Artifact (created|updated): /, "").split(" ")[0];
        setSelectedArtifactId(id);
        setArtifactPanelOpen(true);
      }
    }
    // Auto-consolidate memory every 10 messages, unless memory is off (temporary chats never save).
    if (!isSide && !conversation?.temporary && !conversation?.memoryDisabled && all.length > 0 && all.length % 10 === 0) {
      fetch(`/api/memory/consolidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, model: conversation?.model }),
      }).catch(() => {});
    }
    // Suggest a next message from the last exchange; shown greyed in the box,
    // accepted with the arrow button or the → key.
    const exchange = finish?.isAbort || isSide ? null : lastExchange(all);
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
  }, [refreshConversation, fetchContextUsage, messages, setSelectedArtifactId, setArtifactPanelOpen, setIsCompressing, conversationId, conversation?.model, conversation?.temporary, conversation?.memoryDisabled, isSide]);

  onErrorRef.current = useCallback((err: Error) => {
    const msg = err?.message || String(err);
    toast(msg, "error");
    if (msg.includes("does not support tools") || (msg.includes("does not support") && msg.includes("tools")) ||
        msg.includes("model does not support") || (msg.includes("no") && msg.includes("tool support"))) {
      setToolErrorDialogOpen(true);
    }
  }, [toast]);

  /* ─── Agent messaging ──────────────────────────────────────────────────── */

  const setAgentPane = split?.setAgentPane;
  // Other panes reach this one through its handle; republished on every render so it sees the latest state.
  useEffect(() => {
    // Not before the chat has loaded: its model and settings go out with the message.
    if (!conversation) return;
    setAgentPane?.(conversationId, {
      isLoading: () => isLoading,
      deliver: (parts) => {
        chatSend({ parts }).catch((err: unknown) => console.error("[agent] delivery failed:", err));
      },
      queueAgent,
      dropAgentQueued,
    });
  });
  useEffect(() => () => setAgentPane?.(conversationId, null), [conversationId, setAgentPane]);
  useEffect(() => {
    onSendToChatRef.current = (input) =>
      split ? split.sendToChat(conversationId, input.to, input.message) : Promise.resolve(AGENT_NOT_OPEN);
  });

  /** Tool-less "Send to…": this reply goes to another open chat as an agent message. */
  function sendToPane(targetId: string, text: string) {
    const result = split?.deliverTo(conversationId, targetId, text);
    if (result && result !== AGENT_DELIVERED) toast(result, "info");
  }

  /* ─── Initial fetches ──────────────────────────────────────────────────── */

  const [convLoaded, setConvLoaded] = useState(false);
  const autoSubmittedRef = useRef(false);

  // A reload stops the reply, so queued messages the server never took come back into the input box.
  useEffect(() => {
    if (!convLoaded) return;
    fetch(queuedUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then(async (d) => {
        const rows = (d?.queued ?? []).map((q: { id: string; text: string; agent?: AgentMessageData }) => ({ ...q, stored: true }));
        // Every row is taken off the server; an agent message is dropped, since the user did not write it.
        if (rows.length) restoreInput((await takeRows(rows)).filter((r) => !r.agent).map((r) => r.text));
      })
      .catch(() => {});
  }, [convLoaded]);

  useEffect(() => {
    fetchConversation().then(() => setConvLoaded(true));
  }, [conversationId]);
  useEffect(() => {
    // One-shot per pane: the ref stops a later render from sending the prompt again.
    if (!convLoaded || autoSubmittedRef.current) return;
    const prompt = initialPrompt ?? takeSideQuestion(conversationId);
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
  // "Send to main" on a side reply: prefill this chat's box, focus it, send nothing.
  useEffect(() => {
    function onSendToMain(e: Event) {
      const { id, text } = (e as CustomEvent<{ id: string; text: string }>).detail;
      if (id !== conversationId) return;
      setInput((prev) => (prev.trim() ? `${prev}\n\n${text}` : text));
      document.querySelector<HTMLTextAreaElement>(`[data-pane-id="${conversationId}"] textarea`)?.focus();
    }
    window.addEventListener("vas:send-to-main", onSendToMain);
    return () => window.removeEventListener("vas:send-to-main", onSendToMain);
  }, [conversationId]);

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
    onForked: (newId) => split?.replaceAt(conversationId, newId),
  });

  const {
    regenModal, setRegenModal,
    handleClarificationAnswer, handleEditMessage, handleDeleteMessage, handleCopyMessage, handleForkMessage,
    handleRegenExecute,
  } = msgActions;

  // Regenerating drops the reply's queued messages from the history, so their text goes back to the input first.
  const handleRegenerateMessage = (messageId: string) => {
    const msg = messages.find((m) => m.id === messageId);
    const texts = ((msg?.parts ?? []) as any[]).filter((p) => p.type === "data-queued-message").map((p) => p.data?.text ?? "");
    if (texts.length) setInput((prev) => [...texts, prev].filter(Boolean).join("\n\n"));
    msgActions.handleRegenerateMessage(messageId);
  };

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
    if (isSubagent) return; // a sub-agent transcript is read only
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
          setMode, setRequestBody, toolsAvailable,
          openSide: (question) => {
            // /side from a side chat opens the side chat of its main chat.
            const mainId = isSide ? conversation?.parentId : conversationId;
            if (!mainId) {
              toast("Side chats open from a main chat", "info");
              return;
            }
            void split?.openSide(mainId, question);
          },
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
    if (keyboardShortcutsOpen) setKeyboardShortcutsOpen(false);
    else if (toolErrorDialogOpen) setToolErrorDialogOpen(false);
    else if (contextPanelOpen) setContextPanelOpen(false);
    else if (modelSettingsOpen) setModelSettingsOpen(false);
    else if (advancedOpen) setAdvancedOpen(false);
    else if (artifactPanelOpen) setArtifactPanelOpen(false);
    else if (todoPanelOpen) setTodoPanelOpen(false);
    else if (scratchpadOpen) setScratchpadOpen(false);
  }, [toolErrorDialogOpen, contextPanelOpen, modelSettingsOpen, advancedOpen, artifactPanelOpen, todoPanelOpen, scratchpadOpen, keyboardShortcutsOpen]);

  /* ─── Keyboard: only the focused pane answers ──────────────────────────── */

  const toggleSidePane = () => (isSide ? split?.closeChat(conversationId) : split?.toggleSide(conversationId));

  useKeyboardShortcuts({
    onToggleSidePane: focused ? toggleSidePane : undefined,
    onSend: focused ? () => handleSubmit() : undefined,
    isDialogOpen: focused && isDialogOpen,
    onCloseDialog: focused ? closeTopDialog : undefined,
    onOpenKeyboardShortcuts: focused ? () => setKeyboardShortcutsOpen(true) : undefined,
  });

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
    enabledTools, enabledSkills, persistAdvanced,
    answerApproval, answerPlan, approvePlanReply, toolsAvailable, mode, setMode, modelCaps, setModelCaps, toggleSidePane,
    allowedToolCount: allowedTools.length, resetAllowedTools,
    selectedKbId, setSelectedKbId,
    scrollRef, toast,
    messages, sendMessage, status, stop: stopReply, regenerate, error, setMessages, addToolResult,
    isLoading, currentModelName,
    fetchConversation, refreshConversation, refreshConversationAndMessages,
    fetchContextUsage, handleModelSettingsSave, handleModelChange, handleWorkingFolderChange, handleKbToggle,
    handleClarificationAnswer, handleEditMessage, handleDeleteMessage, handleCopyMessage, handleForkMessage,
    handleRegenerateMessage, handleRegenExecute, regenModal, setRegenModal,
    queued, queueMessage, editQueued, removeQueued, retryQueued,
    handleSubmit, isSubagent, sendToPane,
    minimapMessages,
    isDialogOpen, closeTopDialog,
  };
}
