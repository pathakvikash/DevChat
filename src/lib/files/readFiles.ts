import { prisma } from "@/lib/db";
import { FOLDER_TOOL_NAMES, READ_FILES_MARKER } from "./folderTools";

const hasFolderPart = { OR: [...FOLDER_TOOL_NAMES.map((n) => ({ parts: { contains: `"tool-${n}"` } })), { parts: { contains: READ_FILES_MARKER } }] };

/** True when the chat, or a helper it started (a child run saves its own tool calls), has a stored folder-tool call: file text is in its history. */
export async function conversationReadFiles(conversationId: string): Promise<boolean> {
  const rows = await prisma.message.findMany({
    where: { ...hasFolderPart, conversation: { OR: [{ id: conversationId }, { parentId: conversationId }] } },
    select: { id: true },
    take: 1,
  });
  return rows.length > 0;
}

/** Ids of the user's chats that read files, with the parent of a helper run that did (one query). Their text must not be quoted elsewhere. */
export async function chatsThatReadFiles(userId: string): Promise<string[]> {
  const rows = await prisma.message.findMany({
    where: { ...hasFolderPart, conversation: { userId } },
    select: { conversationId: true, conversation: { select: { parentId: true } } },
    distinct: ["conversationId"],
  });
  return [...new Set(rows.flatMap((r) => [r.conversationId, ...(r.conversation.parentId ? [r.conversation.parentId] : [])]))];
}
