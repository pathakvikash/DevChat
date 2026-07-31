import { prisma } from "@/lib/db";
import type { Message } from "@prisma/client";

export type MessageLookupResult =
  | { ok: true; message: Message }
  | { ok: false; reason: "not_found" | "wrong_conversation" };

/** Looks up a message by id and confirms it belongs to `conversationId`, which
 *  must itself belong to `userId`. */
export async function findConversationMessage(
  conversationId: string,
  messageId: string,
  userId: string,
): Promise<MessageLookupResult> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { userId: true },
  });
  if (!conversation || conversation.userId !== userId) {
    return { ok: false, reason: "not_found" };
  }
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) return { ok: false, reason: "not_found" };
  if (message.conversationId !== conversationId) {
    return { ok: false, reason: "wrong_conversation" };
  }
  return { ok: true, message };
}
