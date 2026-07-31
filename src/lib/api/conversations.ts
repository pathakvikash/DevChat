import { prisma } from "@/lib/db";

export interface ConversationModelInfo {
  id: string;
  model: string;
}

/** Looks up just the `id`/`model` of a conversation owned by `userId` — enough to know it exists and which model to use. */
export async function getConversationOrNull(
  id: string,
  userId: string,
): Promise<ConversationModelInfo | null> {
  return prisma.conversation.findFirst({
    where: { id, userId },
    select: { id: true, model: true },
  });
}
