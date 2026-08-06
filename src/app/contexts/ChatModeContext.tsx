"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { ChatMode } from "@/app/components/conversation/types";

interface ChatModeValue {
  mode: ChatMode;
  setMode: (next: ChatMode) => void;
}

const ChatModeContext = createContext<ChatModeValue | null>(null);

/**
 * Holds the chat/agent mode. Lives above the page so the sidebar and the header
 * toggles share one source of truth. Per-conversation, localStorage only.
 */
export function ChatModeProvider({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const conversationId = typeof params?.id === "string" ? params.id : undefined;
  const storageKey = conversationId ? `vas:mode:${conversationId}` : null;
  const [mode, setModeState] = useState<ChatMode>("chat");

  // Re-read on route change so mode doesn't leak between conversations.
  useEffect(() => {
    if (!storageKey) {
      setModeState("chat");
      return;
    }
    try {
      setModeState(localStorage.getItem(storageKey) === "agent" ? "agent" : "chat");
    } catch {
      setModeState("chat");
    }
  }, [storageKey]);

  const setMode = useCallback(
    (next: ChatMode) => {
      setModeState(next);
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, next);
      } catch {}
    },
    [storageKey],
  );

  return (
    <ChatModeContext.Provider value={{ mode, setMode }}>
      {children}
    </ChatModeContext.Provider>
  );
}

/** For components that only render inside a conversation. */
export function useChatMode(): ChatModeValue {
  const ctx = useContext(ChatModeContext);
  if (!ctx) throw new Error("useChatMode must be used within a ChatModeProvider");
  return ctx;
}

/** Null outside a conversation — lets the sidebar hide the toggle on /kb etc. */
export function useChatModeOptional(): ChatModeValue | null {
  return useContext(ChatModeContext);
}
