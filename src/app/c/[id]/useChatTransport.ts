"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from "ai";

import { runCode } from "@/lib/sandbox";
import { parseDataArtifact } from "@/lib/generativeUi/data";
import { shouldAutoContinue, type AnyPart } from "@/lib/utils/messageParts";
import type { ChatMode } from "@/lib/chat/modes";
import type { AgentPane } from "@/lib/chat/agentMessages";

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
}

interface ChatTransportOptions {
  conversationId: string;
  conversation: { model?: string; systemPrompt?: string; temperature?: number; chatOnlyMode?: boolean; memoryDisabled?: boolean; maxToolCalls?: number } | null;
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

/** The tool call is the last part of the reply, finished: the model answers after it. */
function endsWithSendToChat(parts: AnyPart[]): boolean {
  const list = parts.filter((p) => p?.type !== "reasoning" && p?.type !== "step-start");
  const tail = list[list.length - 1] as { type?: string; state?: string } | undefined;
  return tail?.type === "tool-sendToChat" && tail.state === "output-available";
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

  const transport = useMemo(
    () =>
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

  const chat = useChat({
    id: conversationId,
    experimental_throttle: 50,
    transport,
    // A reply that waits on approvals resumes once every card is answered; executeCode and
    // an answered plan card resume on their own.
    sendAutomaticallyWhen: ({ messages: msgs }) => {
      if (lastAssistantMessageIsCompleteWithApprovalResponses({ messages: msgs })) return true;
      const last = msgs[msgs.length - 1];
      return last?.role === "assistant" && (shouldAutoContinue(last.parts as AnyPart[]) || endsWithSendToChat(last.parts as AnyPart[]));
    },
    onToolCall: async ({ toolCall }) => {
      if (toolCall.toolName === "askClarification") return;
      if (toolCall.toolName === "sendToChat") {
        const input = toolCall.input as { to: string; message: string };
        const output = await onSendToChatRef.current(input).catch((e: unknown) => `Not sent: ${e instanceof Error ? e.message : String(e)}`);
        chat.addToolResult({ tool: "sendToChat", toolCallId: toolCall.toolCallId, output });
        return;
      }
      if (toolCall.toolName === "executeCode") {
        const { language, code, saveAs } = toolCall.input as {
          language: "python" | "javascript";
          code: string;
          saveAs?: { title: string };
        };
        try {
          const output = await runCode(language, code);
          const result =
            saveAs?.title && !CODE_FAILED_RE.test(output)
              ? await saveDataArtifact(conversationId, saveAs.title, output)
              : output;
          chat.addToolResult({ tool: "executeCode", toolCallId: toolCall.toolCallId, output: result });
        } catch (e: any) {
          chat.addToolResult({ tool: "executeCode", toolCallId: toolCall.toolCallId, output: `Error: ${e?.message || String(e)}` });
        }
      }
    },
    onData: (part) => {
      if (part.type === "data-compressing") setIsCompressing(true);
      if (part.type === "data-queued-message") onQueuedDeliveredRef.current(String((part.data as { queuedId?: string })?.queuedId ?? ""));
    },
    onError: (err) => { onErrorRef.current(err); },
    onFinish: (finish) => { onFinishRef.current(finish); },
  });

  const isLoading = chat.status === "submitted" || chat.status === "streaming";

  // The body is read when a request goes out, so a mode or allow-list change made right before
  // an automatic resume (plan approval, "Allow for this chat") must land here, not after render.
  const setRequestBody = useCallback((patch: { mode?: ChatMode; allowedTools?: string[] }) => {
    Object.assign(transportBodyRef.current, patch);
  }, []);

  return { ...chat, isLoading, setRequestBody };
}
