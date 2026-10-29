/** The one rule for what a compression leaves live. Messages saved before `compressedAt` are
 *  summarized; that message and later ones stay in the view and in the prompt. */
export function liveSince(compressedAt: Date | string | null | undefined) {
  const cut = compressedAt ? new Date(compressedAt) : null;
  return {
    /** Prisma `where` for the live messages. */
    where: cut ? { createdAt: { gte: cut } } : {},
    /** Prisma `where` for the summarized ones. */
    summarizedWhere: cut ? { createdAt: { lt: cut } } : { id: { in: [] as string[] } },
    isLive: (m: { createdAt: Date | string }) => !cut || new Date(m.createdAt) >= cut,
  };
}
