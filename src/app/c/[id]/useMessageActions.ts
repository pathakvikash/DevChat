"use client";

import { useState, useCallback } from "react";
import { runWebSearch, formatWebSearchResults } from "./webSearch";

interface UseMessageActionsOptions {
  conversationId: string;
  messages: any[];
  setMessages: React.Dispatch<React.SetStateAction<any[]>>;
  status: string;
  sendMessage: (...args: any[]) => any;
  regenerate: (...args: any[]) => any;
  addToolResult: (...args: any[]) => void;
  toast: (msg: string, type: "success" | "error" | "info") => void;
}

export function useMessageActions({
  conversationId,
  messages,
  setMessages,
  status,
  sendMessage,
  regenerate,
  addToolResult,
  toast,
}: UseMessageActionsOptions) {
  const [regenModal, setRegenModal] = useState<{
    type: "retry" | "message";
    messageId?: string;
    userMessageText: string;
    userCreatedAt?: string;
    userMessageIdx?: number;
  } | null>(null);

  const handleClarificationAnswer = useCallback(
    async (toolCallId: string, answer: string) => {
      if (status === "submitted" || status === "streaming") return;
      addToolResult({
        tool: "askClarification",
        toolCallId,
        output: answer,
      });
      const msgCount = messages.length;
      try {
        await sendMessage({ parts: [{ type: "text" as const, text: answer }] });
        setMessages((prev: any[]) => (prev as any[]).filter((_, i) => i !== msgCount));
      } catch (e) {
        console.error("[clarification] sendMessage failed:", e);
      }
    },
    [addToolResult, sendMessage, messages.length, setMessages, status],
  );

  async function handleEditMessage(messageId: string, content: string) {
    const snapshot = messages;
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok && res.status !== 404) throw new Error("Failed to update message");
      if (res.ok) {
        const updated = await res.json();
        setMessages((prev: any[]) =>
          prev.map((m) => (m.id === messageId ? { ...m, parts: updated.parts ?? m.parts } : m)),
        );
      } else {
        setMessages((prev: any[]) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, parts: [{ type: "text", text: content }] } : m,
          ),
        );
      }
    } catch (error) {
      console.error("Failed to edit message:", error);
      toast("Failed to edit message", "error");
      setMessages(() => snapshot);
    }
  }

  async function handleDeleteMessage(messageId: string) {
    const snapshot = messages;
    setMessages((prev: any[]) => prev.filter((m) => m.id !== messageId));
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${messageId}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404) {
        console.error(`Failed to delete message (server returned ${res.status})`);
        setMessages(() => snapshot);
      }
    } catch (error) {
      console.error("Failed to delete message:", error);
      toast("Failed to delete message", "error");
      setMessages(() => snapshot);
    }
  }

  function handleCopyMessage(content: string) {
    navigator.clipboard.writeText(content);
  }

  const handleRegenerate = useCallback(() => {
    if (status === "streaming" || status === "submitted") return;

    let lastAssistantId: string | undefined;
    let lastUserCreatedAt: string | undefined;
    let lastUserText = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i] as any;
      if (!lastAssistantId && m.role === "assistant") {
        lastAssistantId = m.id;
      }
      if (m.role === "user" && (m as any).createdAt) {
        lastUserCreatedAt = (m as any).createdAt;
        const parts = (m.parts || []) as any[];
        lastUserText = parts
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join("");
        break;
      }
    }

    if (!lastAssistantId) {
      const lastUser = [...messages].reverse().find((m: any) => m.role === "user");
      if (lastUser) {
        const parts = (lastUser as any).parts || [];
        const textParts = parts.filter((p: any) => p.type === "text");
        if (textParts.length > 0) {
          sendMessage({
            parts: textParts.map((p: any) => ({ type: "text" as const, text: p.text })),
          });
        }
      }
      return;
    }

    setRegenModal({
      type: "retry",
      messageId: lastAssistantId,
      userMessageText: lastUserText,
      userCreatedAt: lastUserCreatedAt,
    });
  }, [messages, status, conversationId, sendMessage]);

  const handleRegenerateMessage = useCallback(
    (messageId: string) => {
      if (status === "streaming" || status === "submitted") return;

      const msgs = messages as any[];
      const targetIdx = msgs.findIndex((m) => m.id === messageId);
      if (targetIdx < 0 || msgs[targetIdx]?.role !== "assistant") return;

      let userIdx = targetIdx - 1;
      while (userIdx >= 0 && msgs[userIdx]?.role !== "user") userIdx--;
      if (userIdx < 0) return;

      const userMsg = msgs[userIdx];
      const parts = (userMsg.parts || []) as any[];
      const userText = parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("");

      setRegenModal({
        type: "message",
        messageId,
        userMessageText: userText,
        userMessageIdx: userIdx,
      });
    },
    [messages, status, conversationId],
  );

  const handleRegenExecute = useCallback(
    async (mode: "retry" | "think" | "search", additionalInput: string) => {
      const ctx = regenModal;
      setRegenModal(null);
      if (!ctx) return;

      let modifiedText = ctx.userMessageText;

      switch (mode) {
        case "think":
          modifiedText =
            "Think through this carefully, step by step. Verify your reasoning before answering.\n\n" +
            modifiedText;
          break;
        case "search": {
          const query = ctx.userMessageText.slice(0, 200);
          try {
            const results = await runWebSearch(query);
            if (results.length > 0) {
              const formatted = formatWebSearchResults(results);
              modifiedText = `[Web Search Results]\n${formatted}\n\n---\n\nOriginal request: ${ctx.userMessageText}`;
            }
          } catch (e) {
            console.error("[regen] web search failed:", e);
          }
          break;
        }
      }

      if (additionalInput.trim()) {
        modifiedText += "\n\n[Additional instructions: " + additionalInput.trim() + "]";
      }

      if (!modifiedText.trim()) return;

      if (ctx.type === "retry") {
        const msgs = messages as any[];
        let lastUserIdx = -1;
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i]?.role === "user") {
            lastUserIdx = i;
            break;
          }
        }
        if (lastUserIdx >= 0) {
          setMessages(msgs.slice(0, lastUserIdx + 1) as any);
        }

        if (ctx.userCreatedAt) {
          try {
            await fetch(
              `/api/conversations/${conversationId}/messages?afterTimestamp=${encodeURIComponent(ctx.userCreatedAt)}`,
              { method: "DELETE" },
            );
          } catch (e) {
            console.error("[handleRegenExecute] failed to delete messages:", e);
            toast("Failed to regenerate", "error");
          }
        }

        try {
          await regenerate({ parts: [{ type: "text" as const, text: modifiedText }] });
        } catch (e) {
          console.error("[handleRegenExecute] regenerate failed:", e);
          toast("Failed to regenerate", "error");
        }
      } else if (ctx.type === "message" && ctx.messageId && ctx.userMessageIdx !== undefined) {
        const msgs = messages as any[];
        setMessages(msgs.slice(0, ctx.userMessageIdx + 1) as any);

        try {
          await fetch(`/api/conversations/${conversationId}/messages/${ctx.messageId}/branch`, {
            method: "POST",
          });
        } catch (e) {
          console.error("[handleRegenExecute] failed to branch messages:", e);
          toast("Failed to regenerate message", "error");
        }

        try {
          await regenerate({ parts: [{ type: "text" as const, text: modifiedText }] });
        } catch (e) {
          console.error("[handleRegenExecute] regenerate failed:", e);
          toast("Failed to regenerate message", "error");
        }
      }
    },
    [regenModal, conversationId, messages, setMessages, regenerate, toast],
  );

  return {
    regenModal,
    setRegenModal,
    handleClarificationAnswer,
    handleEditMessage,
    handleDeleteMessage,
    handleCopyMessage,
    handleRegenerate,
    handleRegenerateMessage,
    handleRegenExecute,
  };
}
