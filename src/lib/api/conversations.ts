import { prisma } from "@/lib/db";

export interface ConversationModelInfo {
  id: string;
  model: string;
  kind: string;
}

/** Looks up just the `id`/`model`/`kind` of a conversation owned by `userId` — enough to know it exists, which model to use and whether it is a side chat. */
export async function getConversationOrNull(
  id: string,
  userId: string,
): Promise<ConversationModelInfo | null> {
  return prisma.conversation.findFirst({
    where: { id, userId },
    select: { id: true, model: true, kind: true },
  });
}
