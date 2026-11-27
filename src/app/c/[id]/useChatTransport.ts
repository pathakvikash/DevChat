"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from "ai";

import { runCode } from "@/lib/sandbox";
import { parseDataArtifact } from "@/lib/generativeUi/data";
import { shouldAutoContinue, waitsForApproval, type AnyPart } from "@/lib/utils/messageParts";
import type { ChatMode } from "@/lib/chat/modes";
import type { AgentPane } from "@/lib/chat/agentMessages";
import { buildSavePayload, type SavePayload } from "@/lib/bridge/client";
import { createRoutingTransport, type BridgeTurn } from "@/app/hooks/bridgeTransport";

/** Python tracebacks and our sandbox's own failures both start this way. */
const CODE_FAILED_RE = /^(Error|Traceback)/;
const PREVIEW_LINES = 15;

const preview = (output: string) => output.split("\n").slice(0, PREVIEW_LINES).join("\n");

/** Stores `executeCode` output as a `type: "data"` artifact so big tables stay out of the
 *  transcript. Failures return text rather than throwing, so the model can retry. */
async function saveDataArtifact(conversationId: string, title: string, output: string): Promise<string> {
  // An id pointing at non-tabular text is worse than no id — Chart/Table would fail
  // on it later with no way back, so refuse it and say what to change.
  let rows: number;
  try {
    rows = parseDataArtifact(output).rows.length;
  } catch {
    return (
      `No data captured for "${title}": the code must PRINT the dataset as its last statement — ` +
      `\`print(json.dumps({"columns": [...], "rows": [[...]]}))\` (or CSV). Returning, assigning or ` +
      `displaying it is not enough; nothing but stdout is captured. Re-run the code with that print, ` +
      `or drop \`saveAs\` and print the rows inline.\n\nOutput was:\n${preview(output)}`
    );
  }
  try {
    const res = await fetch(`/api/conversations/${conversationId}/artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "data", title, content: output }),
    });
    if (!res.ok) throw new Error(`save failed with HTTP ${res.status}`);
    const { id } = (await res.json()) as { id: string };
    return `Data artifact created: ${id} — "${title}" (${rows} rows). Use dataArtifactId "${id}" in Chart or Table.\n\nPreview:\n${preview(output)}`;
  } catch (e) {
    return `Error saving data artifact: ${e instanceof Error ? e.message : String(e)}\n\nOutput:\n${output}`;
  }
}

/** What `useChat`'s `onFinish` hands over. Use its `messages` (the store's own array):
 *  React has not re-rendered yet, so render-closure state is stale here. */
export interface ChatFinish {
  message?: UIMessage;
  messages?: UIMessage[];
  isAbort?: boolean;
  isError?: boolean;
  /** The turn ran on the local bridge (the page saved it itself): server-only follow-ups like suggestions are skipped. */
  viaBridge?: boolean;
}

interface ChatTransportOptions {
  conversationId: string;
  conversation: { model?: string; systemPrompt?: string; temperature?: number; chatOnlyMode?: boolean; memoryDisabled?: boolean; maxToolCalls?: number; reasoningEffort?: string | null } | null;
  selectedKbId: string;
  searchProvider: string;
  enabledTools: string[];
  enabledSkills: string[];
  mode: ChatMode;
  /** Tools the user allowed for this chat in Ask mode. */
  allowedTools: string[];
  /** The server announced it is compressing the conversation. */
  setIsCompressing: (compressing: boolean) => void;
  onFinishRef: React.MutableRefObject<(finish: ChatFinish) => void>;
  onErrorRef: React.MutableRefObject<(err: Error) => void>;
  /** A queued message was delivered into the reply (its marker arrived). */
  onQueuedDeliveredRef: React.MutableRefObject<(queuedId: string) => void>;
  /** The other open chat panes, sent with each request so the model knows whom it can message. */
  openPanes: AgentPane[];
  /** The sendToChat tool: resolves to the result the model reads. */
  onSendToChatRef: React.MutableRefObject<(input: { to: string; message: string }) => Promise<string>>;
}

export function useChatTransport(opts: ChatTransportOptions) {
  const { conversationId, conversation, selectedKbId, searchProvider, enabledTools, enabledSkills, mode, allowedTools, setIsCompressing, onFinishRef, onErrorRef, onQueuedDeliveredRef, openPanes, onSendToChatRef } = opts;

  const transportBodyRef = useRef({
    conversationId,
    model: conversation?.model,
    systemPrompt: conversation?.systemPrompt,
    temperature: conversation?.temperature,
    kbId: selectedKbId || undefined,
    searchProvider,
    enabledTools,
    enabledSkills,
    mode,
    allowedTools,
    chatOnlyMode: conversation?.chatOnlyMode ?? false,
    memoryDisabled: conversation?.memoryDisabled ?? false,
    maxToolCalls: conversation?.maxToolCalls ?? 5,
    autoCompressThreshold: 85,
    openPanes,
  });

  useEffect(() => {
    const threshold = typeof window !== "undefined"
      ? parseInt(localStorage.getItem("vas:settings:auto_compress_threshold") || "85", 10)
      : 85;
    transportBodyRef.current = {
      conversationId,
      model: conversation?.model,
      systemPrompt: conversation?.systemPrompt,
      temperature: conversation?.temperature,
      kbId: selectedKbId || undefined,
      searchProvider,
      enabledTools,
      enabledSkills,
      mode,
      allowedTools,
      chatOnlyMode: conversation?.chatOnlyMode ?? false,
      memoryDisabled: conversation?.memoryDisabled ?? false,
      maxToolCalls: conversation?.maxToolCalls ?? 5,
      autoCompressThreshold: threshold,
      openPanes,
    };
  }, [conversationId, conversation?.model, conversation?.systemPrompt, conversation?.temperature, selectedKbId, searchProvider, enabledTools, enabledSkills, mode, allowedTools, conversation?.chatOnlyMode, conversation?.memoryDisabled, conversation?.maxToolCalls, openPanes]);

  // What a bridge turn also needs; kept out of transportBodyRef, which goes to the server as is.
  const effortRef = useRef(conversation?.reasoningEffort);
  useEffect(() => {
    effortRef.current = conversation?.reasoningEffort;
  }, [conversation?.reasoningEffort]);
  // The turn that went to the local bridge, until onFinish saves it.
  const bridgeTurnRef = useRef<BridgeTurn | null>(null);

  // The closures below read the refs when a request goes out, never during render.
  const serverTransport = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- read at send time
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => transportBodyRef.current,
        prepareSendMessagesRequest: ({ body, id, messages, trigger, messageId }) => ({
          body: {
            ...body,
            conversationId: id,
            id,
            messages,
            trigger,
            messageId,
          },
        }),
      }),
    [],
  );
  const getBridgeContext = useCallback(() => {
    const b = transportBodyRef.current;
    return { model: b.model, systemPrompt: b.systemPrompt, mode: b.mode, allowedTools: b.allowedTools, reasoningEffort: effortRef.current };
  }, []);
  const onBridgeTurn = useCallback((turn: BridgeTurn) => {
    bridgeTurnRef.current = turn;
  }, []);
  const transport = useMemo(
    // eslint-disable-next-line react-hooks/refs -- the transport only calls getBridgeContext when a request goes out
    () => createRoutingTransport({ server: serverTransport, getContext: getBridgeContext, onBridgeTurn }),
    [serverTransport, getBridgeContext, onBridgeTurn],
  );

  // A bridge turn never passes through this server, so the page saves the finished turn. The ids of user messages already
  // saved are kept, so a resume after an approval (or a retry) does not send the question twice.
  const [bridgeSaveFailed, setBridgeSaveFailed] = useState(false);
  const savedUserIds = useRef(new Set<string>());
  const unsavedRef = useRef<SavePayload | null>(null);
  const postBridgeTurn = useCallback(async () => {
    const payload = unsavedRef.current;
    if (!payload) return;
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (payload.user) savedUserIds.current.add(payload.user.id);
      if (unsavedRef.current === payload) unsavedRef.current = null;
      setBridgeSaveFailed(false);
    } catch {
      setBridgeSaveFailed(true);
    }
  }, [conversationId]);
  /** Called from onFinish: saves the turn when it ran on the bridge. True when it did. */
  const persistBridgeTurn = useCallback(
    (finish: ChatFinish): boolean => {
      const turn = bridgeTurnRef.current;
      if (!turn) return false;
      bridgeTurnRef.current = null;
      const payload = buildSavePayload({ messages: finish.messages ?? [], model: turn.model, continuing: turn.continuing, savedUserIds: savedUserIds.current });
      if (payload) {
        unsavedRef.current = payload;
        void postBridgeTurn();
      }
      return true;
    },
    [postBridgeTurn],
  );
  // useChat keeps the callbacks it was created with, so onFinish goes through this ref.
  const persistBridgeRef = useRef(persistBridgeTurn);
  useEffect(() => {
    persistBridgeRef.current = persistBridgeTurn;
  }, [persistBridgeTurn]);

  const chat = useChat({
    id: conversationId,
    experimental_throttle: 50,
    transport,
    // A reply that waits on approvals resumes once every card is answered; executeCode and
    // an answered plan card resume on their own.
    sendAutomaticallyWhen: ({ messages: msgs }) => {
      if (lastAssistantMessageIsCompleteWithApprovalResponses({ messages: msgs })) return true;
      const last = msgs[msgs.length - 1];
      return last?.role === "assistant" && shouldAutoContinue(last.parts as AnyPart[]);
    },
    onToolCall: async ({ toolCall }) => {
      // Asks first (see buildTools): the card runs it after Allow, so nothing runs before the user answers.
      if (waitsForApproval(toolCall as { toolMetadata?: { sendsOut?: boolean } })) return;
      if (toolCall.toolName === "askClarification") return;
      if (toolCall.toolName === "sendToChat") {
        const input = toolCall.input as { to: string; message: string };
        const output = await onSendToChatRef.current(input).catch((e: unknown) => `Not sent: ${e instanceof Error ? e.message : String(e)}`);
        chat.addToolResult({ tool: "sendToChat", toolCallId: toolCall.toolCallId, output });
        return;
      }
      if (toolCall.toolName === "executeCode") await runExecuteCode(toolCall.toolCallId, toolCall.input);
    },
    onData: (part) => {
      if (part.type === "data-compressing") setIsCompressing(true);
      if (part.type === "data-queued-message") onQueuedDeliveredRef.current(String((part.data as { queuedId?: string })?.queuedId ?? ""));
    },
    onError: (err) => { onErrorRef.current(err); },
    onFinish: (finish) => {
      const viaBridge = persistBridgeRef.current(finish);
      onFinishRef.current(viaBridge ? { ...finish, viaBridge } : finish);
    },
  });

  /** Runs `executeCode` in the browser and adds its result. Called on arrival, or after Allow on a card. */
  async function runExecuteCode(toolCallId: string, rawInput: unknown) {
    const { language, code, saveAs } = rawInput as {
      language: "python" | "javascript";
      code: string;
      saveAs?: { title: string };
    };
    try {
      const output = await runCode(language, code, conversationId);
      const result =
        saveAs?.title && !CODE_FAILED_RE.test(output)
          ? await saveDataArtifact(conversationId, saveAs.title, output)
          : output;
      chat.addToolResult({ tool: "executeCode", toolCallId, output: result });
    } catch (e: any) {
      chat.addToolResult({ tool: "executeCode", toolCallId, output: `Error: ${e?.message || String(e)}` });
    }
  }

  const isLoading = chat.status === "submitted" || chat.status === "streaming";

  // The body is read when a request goes out, so a mode or allow-list change made right before
  // an automatic resume (plan approval, "Allow for this chat") must land here, not after render.
  const setRequestBody = useCallback((patch: { mode?: ChatMode; allowedTools?: string[] }) => {
    Object.assign(transportBodyRef.current, patch);
  }, []);

  return { ...chat, isLoading, setRequestBody, runExecuteCode, bridgeSaveFailed, retryBridgeSave: postBridgeTurn };
}
