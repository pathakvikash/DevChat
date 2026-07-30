"use client";

export interface ConversationSummary {
  id: string;
  title: string;
  model: string;
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

export async function createConversation(payload?: { title?: string; model?: string }): Promise<{ id: string }> {
  const res = await fetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "New Chat", ...payload }),
  });
  if (!res.ok) throw new Error("Failed to create conversation");
  return res.json();
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
