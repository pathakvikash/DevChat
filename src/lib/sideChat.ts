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
