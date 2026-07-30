import { prisma } from "@/lib/db";

export interface ConversationModelInfo {
  id: string;
  model: string;
}

/** Looks up just the `id`/`model` of a conversation — enough to know it exists and which model to use. */
export async function getConversationOrNull(id: string): Promise<ConversationModelInfo | null> {
  return prisma.conversation.findUnique({
    where: { id },
    select: { id: true, model: true },
  });
}
