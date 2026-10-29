import { prisma } from "@/lib/db";

export type ForkResult = { ok: true; id: string } | { ok: false; reason: "not_found" };

/** Replaces each old artifact id in a parts JSON string. Ids are cuids, so a plain replace is safe. */
export function rewriteArtifactIds(json: string | null, idMap: Map<string, string>): string | null {
  if (!json) return json;
  let out = json;
  for (const [from, to] of idMap) out = out.split(from).join(to);
  return out;
}

/** Copies a chat into a new normal chat, in one transaction: settings, messages up to and including
 *  `messageId` in (createdAt, id) order, the summary only when it covers them, and the artifacts that
 *  existed at the fork point (ids rewritten in the copied parts). */
export async function forkConversation(
  userId: string,
  conversationId: string,
  messageId: string,
): Promise<ForkResult> {
  return prisma.$transaction<ForkResult>(async (tx) => {
    const source = await tx.conversation.findFirst({
      where: { id: conversationId, userId },
      include: { artifacts: true },
    });
    if (!source) return { ok: false, reason: "not_found" };

    const target = await tx.message.findFirst({ where: { id: messageId, conversationId } });
    if (!target) return { ok: false, reason: "not_found" };

    // Position decides the cut, so two messages with the same timestamp fall on the right side.
    const ordered = await tx.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const messages = ordered.slice(0, ordered.findIndex((m) => m.id === target.id) + 1);

    const summaryCovered = source.compressedAt !== null && source.compressedAt <= target.createdAt;
    const fork = await tx.conversation.create({
      data: {
        userId,
        title: `${source.title} (fork)`,
        forkedFromId: source.id,
        // A fork is always a saved chat. Memory follows the source only when the source is saved.
        temporary: false,
        memoryDisabled: source.temporary ? false : source.memoryDisabled,
        model: source.model,
        persona: source.persona,
        systemPrompt: source.systemPrompt,
        kbId: source.kbId,
        webSearch: source.webSearch,
        temperature: source.temperature,
        maxTokens: source.maxTokens,
        contextLength: source.contextLength,
        topP: source.topP,
        chatOnlyMode: source.chatOnlyMode,
        generativeUiEnabled: source.generativeUiEnabled,
        maxToolCalls: source.maxToolCalls,
        reasoningEffort: source.reasoningEffort,
        workingFolder: source.workingFolder,
        fallbackModel: source.fallbackModel,
        ...(summaryCovered && {
          compressedSummary: source.compressedSummary,
          compressedAt: source.compressedAt,
          compressedBeforeTokens: source.compressedBeforeTokens,
          compressedAfterTokens: source.compressedAfterTokens,
          compressedBeforeMessages: source.compressedBeforeMessages,
        }),
      },
    });

    // Artifacts made after the fork point did not exist when the copy was taken.
    const idMap = new Map<string, string>();
    for (const a of source.artifacts) {
      if (a.createdAt > target.createdAt) continue;
      const copy = await tx.artifact.create({
        data: {
          conversationId: fork.id,
          type: a.type,
          title: a.title,
          content: a.content,
          version: a.version,
        },
      });
      idMap.set(a.id, copy.id);
    }

    await tx.message.createMany({
      data: messages.map(({ id: _id, ...m }) => ({
        ...m,
        conversationId: fork.id,
        parts: rewriteArtifactIds(m.parts, idMap),
      })),
    });

    return { ok: true, id: fork.id };
  });
}
