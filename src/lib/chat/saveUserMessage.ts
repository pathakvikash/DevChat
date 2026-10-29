import { prisma } from "@/lib/db";

/** Saves the user message a chat request is answering, once.
 *  With a client id, an existing row with that id (regenerate, a fallback-model retry) means
 *  it is already saved; without one, the same text as the last user row does. */
export async function saveUserMessage(opts: {
  conversationId: string;
  id?: string;
  text: string;
  parts: unknown[];
  attachments?: unknown;
}): Promise<void> {
  const { conversationId, id, text } = opts;
  const alreadySaved = id
    ? !!(await prisma.message.findFirst({ where: { id, conversationId }, select: { id: true } }))
    : (await prisma.message.findFirst({
        where: { conversationId, role: "user" },
        orderBy: { createdAt: "desc" },
        select: { content: true },
      }))?.content === text;
  if (alreadySaved) return;

  try {
    await prisma.message.create({
      data: {
        ...(id ? { id } : {}),
        conversationId,
        role: "user",
        content: text,
        parts: JSON.stringify(opts.parts),
        attachments:
          Array.isArray(opts.attachments) && opts.attachments.length > 0
            ? JSON.stringify(opts.attachments)
            : null,
      },
    });
  } catch (e) {
    // The raw database text would end up in the client's toast.
    console.error("Failed to save user message:", e);
    throw new Error("Couldn't save your message. Try again.");
  }
}
