"use client";

import { useCallback } from "react";
import { buildMessagesFromConversation } from "@/lib/utils/conversation";
import type { Conversation } from "@/app/components/conversation/types";

async function fetchConversationData(
  conversationId: string,
): Promise<{ ok: true; conv: any } | { ok: false; status: number }> {
  const res = await fetch(`/api/conversations/${conversationId}`);
  if (res.ok) {
    return { ok: true, conv: await res.json() };
  }
  return { ok: false, status: res.status };
}

export interface DataActions {
  fetchConversation: () => Promise<void>;
  refreshConversation: () => Promise<void>;
  refreshConversationAndMessages: () => Promise<void>;
  fetchContextUsage: () => Promise<void>;
  handleModelSettingsSave: (settings: any) => Promise<void>;
  handleModelChange: (modelId: string) => Promise<void>;
  handleKbToggle: () => Promise<void>;
}

export function useConversationData(
  conversationId: string,
  deps: {
    conversation: Conversation | null;
    input: string;
    setConversation: React.Dispatch<React.SetStateAction<Conversation | null>>;
    setMessages: React.Dispatch<React.SetStateAction<any[]>>;
    setSelectedKbId: React.Dispatch<React.SetStateAction<string>>;
    setContextData: React.Dispatch<React.SetStateAction<any>>;
    setLoading: React.Dispatch<React.SetStateAction<boolean>>;
    toast: (msg: string, type: "success" | "error" | "info") => void;
  },
): DataActions {
  const {
    conversation,
    input,
    setConversation,
    setMessages,
    setSelectedKbId,
    setContextData,
    setLoading,
    toast,
  } = deps;

  const applyConversation = useCallback(
    (conv: any, withMessages: boolean) => {
      setConversation(conv);
      setSelectedKbId(conv.kbId || "");
      if (withMessages) {
        setMessages(buildMessagesFromConversation(conv) as any[]);
      }
    },
    [setConversation, setSelectedKbId, setMessages],
  );

  const fetchConversation = useCallback(async () => {
    try {
      const result = await fetchConversationData(conversationId);
      if (result.ok) {
        applyConversation(result.conv, true);
      } else if (result.status === 404) {
        setConversation(null);
      }
    } catch (error) {
      console.error("Failed to fetch conversation:", error);
      toast("Failed to load conversation", "error");
    } finally {
      setLoading(false);
    }
  }, [conversationId, applyConversation, setConversation, setLoading, toast]);

  const refreshConversation = useCallback(async () => {
    try {
      const result = await fetchConversationData(conversationId);
      if (result.ok) applyConversation(result.conv, false);
    } catch (e) {
      console.error("Failed to refresh conversation:", e);
      toast("Failed to refresh conversation", "error");
    }
  }, [conversationId, applyConversation, toast]);

  const refreshConversationAndMessages = useCallback(async () => {
    try {
      const result = await fetchConversationData(conversationId);
      if (result.ok) applyConversation(result.conv, true);
    } catch (e) {
      console.error("Failed to refresh conversation:", e);
      toast("Failed to refresh conversation", "error");
    }
  }, [conversationId, applyConversation, toast]);

  const fetchContextUsage = useCallback(async () => {
    if (!conversation) return;
    try {
      const params = new URLSearchParams();
      params.set("currentMessage", input);
      const res = await fetch(
        `/api/conversations/${conversationId}/context?${params.toString()}`,
      );
      if (res.ok) {
        const data = await res.json();
        setContextData({
          usedTokens: data.usedTokens,
          maxContextTokens: data.maxContextTokens,
          contextPercent: data.contextPercent,
        });
      }
    } catch (e) {
      console.error("Failed to fetch context usage:", e);
      toast("Failed to load context usage", "error");
    }
  }, [conversationId, conversation, input, setContextData, toast]);

  const handleModelSettingsSave = useCallback(
    async (settings: any) => {
      if (settings.kbId !== undefined) {
        setSelectedKbId(settings.kbId || "");
      }
      if (conversation) {
        setConversation({ ...conversation, ...settings });
      }
    },
    [conversation, setConversation, setSelectedKbId],
  );

  const handleModelChange = useCallback(
    async (modelId: string) => {
      if (!conversation) return;
      setConversation({ ...conversation, model: modelId });
      try {
        await fetch(`/api/conversations/${conversationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelId }),
        });
      } catch (e) {
        console.error("Failed to persist model change:", e);
        toast("Failed to change model", "error");
      }
    },
    [conversation, conversationId, setConversation, toast],
  );

  const handleKbToggle = useCallback(async () => {
    if (conversation?.kbId) {
      fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kbId: null }),
      }).catch((e) => {
        console.error("Failed to disable KB:", e);
        toast("Failed to update knowledge base", "error");
      });
      setSelectedKbId("");
    }
  }, [conversation, conversationId, setSelectedKbId, toast]);

  return {
    fetchConversation,
    refreshConversation,
    refreshConversationAndMessages,
    fetchContextUsage,
    handleModelSettingsSave,
    handleModelChange,
    handleKbToggle,
  };
}
