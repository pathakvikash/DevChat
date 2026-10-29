"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ChatMode } from "@/app/components/conversation/types";
import { storedChatMode } from "@/lib/chat/modes";
import { useSplitViewOptional } from "@/app/c/SplitViewContext";

/** What the current chat's model can do. The pane sets it; the mode switch reads it. */
export interface ModelCaps {
  toolsAvailable: boolean;
  /** A CLI-backed model: Ask runs read-only for now. */
  cli: boolean;
}

export interface ChatModeValue {
  mode: ChatMode;
  setMode: (next: ChatMode) => void;
  modelCaps: ModelCaps;
  setModelCaps: (next: ModelCaps) => void;
}

export const ChatModeContext = createContext<ChatModeValue | null>(null);

const MODE_CHANGED = "vas:mode-changed";

/**
 * A chat's mode, kept per conversation in localStorage. Every hook on the same id stays in step
 * through the `vas:mode-changed` event, so the sidebar's switch and a pane's own switch agree.
 */
export function useConversationMode(conversationId: string | null): { mode: ChatMode; setMode: (next: ChatMode) => void } {
  const storageKey = conversationId ? `vas:mode:${conversationId}` : null;
  const [mode, setModeState] = useState<ChatMode>("chat");

  useEffect(() => {
    if (!storageKey) {
      setModeState("chat");
      return;
    }
    try {
      setModeState(storedChatMode(localStorage.getItem(storageKey)));
    } catch {
      setModeState("chat");
    }
  }, [storageKey]);

  useEffect(() => {
    function onChanged(e: Event) {
      const detail = (e as CustomEvent<{ id: string; mode: ChatMode }>).detail;
      if (detail.id === conversationId) setModeState(detail.mode);
    }
    window.addEventListener(MODE_CHANGED, onChanged);
    return () => window.removeEventListener(MODE_CHANGED, onChanged);
  }, [conversationId]);

  const setMode = useCallback(
    (next: ChatMode) => {
      setModeState(next);
      if (!storageKey || !conversationId) return;
      try {
        localStorage.setItem(storageKey, next);
      } catch {}
      window.dispatchEvent(new CustomEvent(MODE_CHANGED, { detail: { id: conversationId, mode: next } }));
    },
    [storageKey, conversationId],
  );

  return { mode, setMode };
}

const DEFAULT_CAPS: ModelCaps = { toolsAvailable: true, cli: false };

/**
 * Layout-level value for the sidebar: the mode of the focused pane. Each pane provides its own
 * value below this for its header and composer (see ConversationPane).
 */
export function ChatModeProvider({ children }: { children: React.ReactNode }) {
  const split = useSplitViewOptional();
  const focus = split?.focus || null;
  const { mode, setMode } = useConversationMode(focus);
  // The focused pane publishes its caps, so the sidebar's switch matches what that chat's model can do.
  const modelCaps = (focus && split?.caps[focus]) || DEFAULT_CAPS;
  const value = useMemo<ChatModeValue>(
    () => ({ mode, setMode, modelCaps, setModelCaps: () => {} }),
    [mode, setMode, modelCaps],
  );
  return <ChatModeContext.Provider value={value}>{children}</ChatModeContext.Provider>;
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
