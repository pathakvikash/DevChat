/** Drops everything up to and including the last message the server already summarized
 *  (`summarizedIds`: saved before `compressedAt`), also messages it has no row for.
 *  The last message is the one being answered, so it always stays. */
export function dropCompressedMessages<T extends { id?: string }>(
  messages: T[],
  summarizedIds: Iterable<string>,
): T[] {
  const summarized = new Set(summarizedIds);
  for (let i = messages.length - 2; i >= 0; i--) {
    const id = messages[i].id;
    if (id && summarized.has(id)) return messages.slice(i + 1);
  }
  return messages;
}
