import { prisma } from "@/lib/db";

/** Temporary chats untouched for this long are deleted the next time the list loads. */
export const TEMPORARY_CHAT_TTL_MS = 24 * 60 * 60 * 1000;

/** Deletes the traces of these chats and of their side chats (traces hold no foreign key). */
export async function deleteTraces(ids: string[]) {
  const children = await prisma.conversation.findMany({ where: { parentId: { in: ids } }, select: { id: true } });
  await prisma.trace.deleteMany({ where: { conversationId: { in: [...ids, ...children.map((c) => c.id)] } } });
}

/** Deletes the user's expired temporary chats and their traces. A chat whose side chat was used within the TTL stays. */
export async function deleteExpiredTemporaryChats(userId: string, now = Date.now()) {
  const cutoff = new Date(now - TEMPORARY_CHAT_TTL_MS);
  const stale = await prisma.conversation.findMany({
    where: {
      userId,
      temporary: true,
      parentId: null, // helpers go with their parent by cascade, never on their own
      updatedAt: { lt: cutoff },
      children: { none: { updatedAt: { gte: cutoff } } },
    },
    select: { id: true },
  });
  if (stale.length === 0) return 0;
  const ids = stale.map((c) => c.id);
  await deleteTraces(ids);
  await prisma.conversation.deleteMany({ where: { id: { in: ids }, userId, temporary: true } });
  return ids.length;
}
