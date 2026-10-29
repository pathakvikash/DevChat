import { prisma } from "@/lib/db";

/** Temporary chats untouched for this long are deleted the next time the list loads. */
export const TEMPORARY_CHAT_TTL_MS = 24 * 60 * 60 * 1000;

/** Deletes the user's expired temporary chats and their traces (traces hold no foreign key). */
export async function deleteExpiredTemporaryChats(userId: string, now = Date.now()) {
  const stale = await prisma.conversation.findMany({
    where: { userId, temporary: true, updatedAt: { lt: new Date(now - TEMPORARY_CHAT_TTL_MS) } },
    select: { id: true },
  });
  if (stale.length === 0) return 0;
  const ids = stale.map((c) => c.id);
  await prisma.trace.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { id: { in: ids }, userId, temporary: true } });
  return ids.length;
}
