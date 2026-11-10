import { useSyncExternalStore } from "react";

/** A side chat as listed under its main chat. */
export interface SideChatSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** Side chats of a main chat, newest first. */
export async function listSideChats(parentId: string): Promise<SideChatSummary[]> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(parentId)}/children?kind=side`);
  if (!res.ok) throw new Error("Failed to list side chats");
  return res.json();
}

/** Creates a side chat under `parentId`, or reuses the newest one if it is still empty. */
export async function createSideChat(parentId: string, model?: string): Promise<{ id: string }> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(parentId)}/children`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(model ? { model } : {}),
  });
  if (!res.ok) throw new Error("Failed to create side chat");
  return res.json();
}

const pendingQuestions = new Map<string, string>();

/** A question for a side chat that is about to open (`/side <question>`); its pane sends it once. */
export function queueSideQuestion(id: string, text: string): void {
  pendingQuestions.set(id, text);
}

export function takeSideQuestion(id: string): string | undefined {
  const text = pendingQuestions.get(id);
  pendingQuestions.delete(id);
  return text;
}

// A selection sent to a side chat from the main chat. The side pane may not be mounted yet, so it waits here
// until the pane takes it (it becomes the pane's one quote card).
export interface SideQuote {
  text: string;
  instruction: string;
}
const sideQuotes = new Map<string, SideQuote>();
const sideQuoteListeners = new Set<() => void>();

export function setSideQuote(id: string, quote: SideQuote): void {
  sideQuotes.set(id, quote);
  sideQuoteListeners.forEach((l) => l());
}

export function takeSideQuote(id: string): void {
  if (sideQuotes.delete(id)) sideQuoteListeners.forEach((l) => l());
}

export function usePendingSideQuote(id: string): SideQuote | undefined {
  return useSyncExternalStore(
    (cb) => (sideQuoteListeners.add(cb), () => void sideQuoteListeners.delete(cb)),
    () => sideQuotes.get(id),
    () => undefined,
  );
}
