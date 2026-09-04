"use client";

import { useEffect, useMemo, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, generateId, type UIMessage } from "ai";

import { runCode } from "@/lib/sandbox";
import { parseDataArtifact } from "@/lib/generativeUi/data";
import { shouldAutoContinue, type AnyPart } from "@/lib/utils/messageParts";

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

// Tracks the client-generated assistant message id per conversation so the
// server can persist the DB message under the same id (see captureGenerateId).

interface ChatTransportOptions {
  conversationId: string;
  conversation: { model?: string; systemPrompt?: string; temperature?: number; chatOnlyMode?: boolean; memoryDisabled?: boolean; maxToolCalls?: number } | null;
  selectedKbId: string;
  searchProvider: string;
  enabledTools: string[];
  enabledSkills: string[];
  /** Chat = read-only tools, Agent = read + write tools. */
  mode: "chat" | "agent";
  onFinishRef: React.MutableRefObject<(finish: ChatFinish) => void>;
  onErrorRef: React.MutableRefObject<(err: Error) => void>;
}

export function useChatTransport(opts: ChatTransportOptions) {
  const { conversationId, conversation, selectedKbId, searchProvider, enabledTools, enabledSkills, mode, onFinishRef, onErrorRef } = opts;

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
    chatOnlyMode: conversation?.chatOnlyMode ?? false,
    memoryDisabled: conversation?.memoryDisabled ?? false,
    maxToolCalls: conversation?.maxToolCalls ?? 5,
    autoCompressThreshold: 85,
    assistantMessageId: undefined as string | undefined,
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
      chatOnlyMode: conversation?.chatOnlyMode ?? false,
      memoryDisabled: conversation?.memoryDisabled ?? false,
      maxToolCalls: conversation?.maxToolCalls ?? 5,
      autoCompressThreshold: threshold,
      assistantMessageId: undefined as string | undefined,
    };
  }, [conversationId, conversation?.model, conversation?.systemPrompt, conversation?.temperature, selectedKbId, searchProvider, enabledTools, enabledSkills, mode, conversation?.chatOnlyMode, conversation?.memoryDisabled, conversation?.maxToolCalls]);

  // Capture the client-generated id of the NEXT assistant message so the
  // server can persist it under the SAME id. Without this, the DB message
  // gets a fresh cuid while the UI keeps the client id, so per-message
  // features (feedback, edit, delete) break until a page refresh re-syncs.
  // Stored on the existing transportBodyRef (already spread into the request
  // body) so it rides along with the next request.
  const captureGenerateId = (...args: Parameters<typeof generateId>) => {
    const id = generateId(...args);
    if (transportBodyRef.current) transportBodyRef.current.assistantMessageId = id;
    return id;
  };

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
    generateId: captureGenerateId,
    transport,
    sendAutomaticallyWhen: ({ messages: msgs }) => {
      const last = msgs[msgs.length - 1];
      return last?.role === "assistant" && shouldAutoContinue(last.parts as AnyPart[]);
    },
    onToolCall: async ({ toolCall }) => {
      if (toolCall.toolName === "askClarification") return;
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
    onError: (err) => { onErrorRef.current(err); },
    onFinish: (finish) => { onFinishRef.current(finish); },
  });

  const isLoading = chat.status === "submitted" || chat.status === "streaming";

  return { ...chat, isLoading };
}
