"use client";

export interface ConversationSummary {
  id: string;
  title: string;
  model: string;
  workingFolder?: string | null;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
}

export async function fetchConversations(): Promise<ConversationSummary[]> {
  const res = await fetch("/api/conversations");
  if (!res.ok) throw new Error("Failed to fetch conversations");
  return res.json();
}

export async function createConversation(payload?: { title?: string; model?: string; temporary?: boolean }): Promise<{ id: string }> {
  const res = await fetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "New Chat", ...payload }),
  });
  if (!res.ok) throw new Error("Failed to create conversation");
  const conv = await res.json();
  // The saved default model was not listed any more, so the server picked another. The chat page shows the note
  // when it opens (a toast from here would be gone before the page changes).
  if (conv.modelReplaced) {
    let last: string | null = null;
    try { last = localStorage.getItem(LAST_NOTED_MODEL_KEY); } catch {} // unreadable: nothing noted yet
    if (shouldNoteModel(conv.modelReplaced, last)) {
      try {
        sessionStorage.setItem(`${MODEL_NOTE_KEY}${conv.id}`, JSON.stringify(conv.modelReplaced));
        localStorage.setItem(LAST_NOTED_MODEL_KEY, conv.modelReplaced.to);
      } catch {}
    }
  }
  return conv;
}

export const MODEL_NOTE_KEY = "vas:modelNote:";
export const LAST_NOTED_MODEL_KEY = "vas:lastNotedModel";

/** A replaced default is always worth a note; an auto-picked model only when it is not the one this browser was last told about. */
export function shouldNoteModel(r: { from: string | null; to: string }, lastNoted: string | null): boolean {
  return !!r.from || r.to !== lastNoted;
}

/** The one-time "your default model is gone" note for this chat, as text, or null. Reading it removes it. */
export function takeModelNote(id: string): string | null {
  try {
    const raw = sessionStorage.getItem(`${MODEL_NOTE_KEY}${id}`);
    if (!raw) return null;
    sessionStorage.removeItem(`${MODEL_NOTE_KEY}${id}`);
    const { from, to, name } = JSON.parse(raw) as { from: string | null; to: string; name?: string };
    const label = (m: string) => m.split("/").pop() || m;
    if (!from) return `Using ${name || label(to)}. Change it in the model picker or set a default in Settings.`;
    return `Your default model ${label(from)} is not available any more, so this chat uses ${label(to)}. You can change it in Settings.`;
  } catch {
    return null;
  }
}

export async function updateConversation(id: string, data: Record<string, unknown>): Promise<void> {
  await fetch(`/api/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteConversation(id: string): Promise<void> {
  await fetch(`/api/conversations/${id}`, { method: "DELETE" });
}

export async function generateTitle(id: string): Promise<{ title?: string }> {
  const res = await fetch(`/api/conversations/${id}/generate-title`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to generate title");
  return res.json();
}
