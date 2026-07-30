"use client";

import { useEffect, useMemo, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, generateId } from "ai";

import { runCode } from "@/lib/sandbox";

// Tracks the client-generated assistant message id per conversation so the
// server can persist the DB message under the same id (see captureGenerateId).

interface ChatTransportOptions {
  conversationId: string;
  conversation: { model?: string; systemPrompt?: string; temperature?: number; chatOnlyMode?: boolean; memoryDisabled?: boolean; maxToolCalls?: number } | null;
  selectedKbId: string;
  searchProvider: string;
  enabledTools: string[];
  enabledSkills: string[];
  onFinishRef: React.MutableRefObject<() => void>;
  onErrorRef: React.MutableRefObject<(err: Error) => void>;
}

export function useChatTransport(opts: ChatTransportOptions) {
  const { conversationId, conversation, selectedKbId, searchProvider, enabledTools, enabledSkills, onFinishRef, onErrorRef } = opts;

  const transportBodyRef = useRef({
    conversationId,
    model: conversation?.model,
    systemPrompt: conversation?.systemPrompt,
    temperature: conversation?.temperature,
    kbId: selectedKbId || undefined,
    searchProvider,
    enabledTools,
    enabledSkills,
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
      chatOnlyMode: conversation?.chatOnlyMode ?? false,
      memoryDisabled: conversation?.memoryDisabled ?? false,
      maxToolCalls: conversation?.maxToolCalls ?? 5,
      autoCompressThreshold: threshold,
      assistantMessageId: undefined as string | undefined,
    };
  }, [conversationId, conversation?.model, conversation?.systemPrompt, conversation?.temperature, selectedKbId, searchProvider, enabledTools, enabledSkills, conversation?.chatOnlyMode, conversation?.memoryDisabled, conversation?.maxToolCalls]);

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
      try {
        const last = msgs[msgs.length - 1];
        if (!last || last.role !== "assistant") return false;
        const parts = (last.parts || []) as any[];
        const tail = parts[parts.length - 1];
        if (!tail || typeof tail.type !== "string") return false;
        if (tail.type !== "tool-executeCode") return false;
        return tail.state === "output-available" || tail.state === "result";
      } catch {
        return false;
      }
    },
    onToolCall: async ({ toolCall }) => {
      if (toolCall.toolName === "askClarification") return;
      if (toolCall.toolName === "executeCode") {
        const { language, code } = toolCall.input as { language: "python" | "javascript"; code: string };
        try {
          const output = await runCode(language, code);
          chat.addToolResult({ tool: "executeCode", toolCallId: toolCall.toolCallId, output });
        } catch (e: any) {
          chat.addToolResult({ tool: "executeCode", toolCallId: toolCall.toolCallId, output: `Error: ${e?.message || String(e)}` });
        }
      }
    },
    onError: (err) => { onErrorRef.current(err); },
    onFinish: () => { onFinishRef.current(); },
  });

  const isLoading = chat.status === "submitted" || chat.status === "streaming";

  return { ...chat, isLoading };
}
