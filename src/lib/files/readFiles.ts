import { prisma } from "@/lib/db";
import { hasFolderToolParts, READ_FILE_PART_TYPES, READ_FILES_MARKER } from "./folderTools";

const hasFolderPart = {
  OR: [
    ...READ_FILE_PART_TYPES.map((t) => ({ parts: { contains: `"${t}"` } })),
    { parts: { contains: READ_FILES_MARKER } },
    // Codex saves no tool parts but always runs inside a folder.
    { role: "assistant", model: { startsWith: "codex/" } },
  ],
};

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

/** What a chat's folder gives its prompt and tools this turn; the chat route and the Context panel both call it. */
export async function chatFolderAccess(o: {
  useTools: boolean;
  cli: boolean;
  folder?: string;
  messages?: unknown;
  conversationId?: string;
  parentId?: string | null;
}): Promise<{ fileFolder?: string; sendsOutGate: boolean; showFolder: boolean }> {
  // CLI models have their own file access; API models get the read-only folder tools.
  const fileFolder = o.useTools && !o.cli ? o.folder : undefined;
  // A chat with a folder is gated from its first turn, whichever kind of model it runs: a CLI model reads files with
  // its own tools before anything is saved. After that it follows the data, not the folder: once the model has read
  // files, clearing the folder does not lift the gate. A side chat is given its parent's context, so file text the parent read counts too.
  const sendsOutGate =
    o.useTools &&
    (!!o.folder ||
      hasFolderToolParts(o.messages) ||
      (!!o.parentId && (await conversationReadFiles(o.parentId))) ||
      (!!o.conversationId && (await conversationReadFiles(o.conversationId))));
  return { fileFolder, sendsOutGate, showFolder: !!o.folder && o.cli };
}
