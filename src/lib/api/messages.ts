import { prisma } from "@/lib/db";
import type { Message } from "@prisma/client";

export type MessageLookupResult =
  | { ok: true; message: Message }
  | { ok: false; reason: "not_found" | "wrong_conversation" };

/** Looks up a message by id and confirms it belongs to `conversationId`. */
export async function findConversationMessage(
  conversationId: string,
  messageId: string,
): Promise<MessageLookupResult> {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) return { ok: false, reason: "not_found" };
  if (message.conversationId !== conversationId) {
    return { ok: false, reason: "wrong_conversation" };
  }
  return { ok: true, message };
}
