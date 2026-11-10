import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { renderTranscript } from "@/lib/chat/renderTranscript";
import { countTokens, cutTokens } from "@/lib/tokens";
import { quotePastChat, titleForHeader } from "@/lib/chat/quotePastChat";

export interface ChatHit {
  id: string;
  title: string;
  model: string;
  updatedAt: Date;
  snippet: string;
}

// TODO(temporary-chat): `Conversation.temporary` lands with that feature; drop the guard then.
const NOT_TEMPORARY = "temporary" in Prisma.ConversationScalarFieldEnum ? { temporary: false } : {};

const CHAT_SELECT = { id: true, title: true, model: true, updatedAt: true } as const;

/** Chats a search returns. */
const LIMIT = 5;
/** Characters of a message shown around the match. */
const SNIPPET_WIDTH = 160;
/** Newest messages `readChat` loads; the token budget trims further. */
const MAX_READ_MESSAGES = 200;
/** SQLite's LIKE is already case-insensitive; Postgres needs `mode`, which only its client has. */
function contains(query: string) {
  return { contains: query, ...("QueryMode" in Prisma ? { mode: "insensitive" as const } : {}) };
}

function snippetAround(text: string, query: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = Math.max(0, flat.toLowerCase().indexOf(query.toLowerCase()));
  const start = Math.max(0, at - 60);
  const end = start + SNIPPET_WIDTH;
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** The user's own main chats whose title or messages match, newest first, one hit per chat. */
export async function searchUserChats(
  userId: string,
  query: string,
  { excludeId }: { excludeId?: string } = {},
): Promise<ChatHit[]> {
  const owned = { userId, ...NOT_TEMPORARY, parentId: null, ...(excludeId ? { id: { not: excludeId } } : {}) };
  const [byTitle, byMessage] = await Promise.all([
    prisma.conversation.findMany({
      where: { ...owned, title: contains(query) },
      select: CHAT_SELECT,
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
    }),
    // ponytail: the newest 100 matching messages bound the scan; page or index if recall misses old chats.
    prisma.message.findMany({
      where: { content: contains(query), conversation: owned },
      select: { id: true, conversation: { select: CHAT_SELECT } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  // One hit per chat; the newest matching message is the one that supplies the snippet.
  const hits = new Map<string, { chat: (typeof byTitle)[number]; messageId?: string }>();
  for (const m of byMessage) {
    if (!hits.has(m.conversation.id)) hits.set(m.conversation.id, { chat: m.conversation, messageId: m.id });
  }
  for (const c of byTitle) if (!hits.has(c.id)) hits.set(c.id, { chat: c });
  const winners = [...hits.values()]
    .sort((a, b) => b.chat.updatedAt.getTime() - a.chat.updatedAt.getTime())
    .slice(0, LIMIT);

  // Message text is only fetched for the chats that made the cut.
  const ids = winners.flatMap((w) => (w.messageId ? [w.messageId] : []));
  const rows = ids.length
    ? await prisma.message.findMany({ where: { id: { in: ids } }, select: { id: true, content: true } })
    : [];
  const contentById = new Map(rows.map((r) => [r.id, r.content]));
  return winners.map(({ chat, messageId }) => ({
    ...chat,
    snippet: messageId ? snippetAround(contentById.get(messageId) ?? "", query) : "",
  }));
}

/**
 * A chat's summary and recent messages as quoted text, or null unless it is the user's own
 * main chat. The text fits `budgetTokens`, frame included.
 */
export async function readUserChat(userId: string, id: string, budgetTokens: number): Promise<string | null> {
  const chat = await prisma.conversation.findFirst({
    where: { id, userId, ...NOT_TEMPORARY, parentId: null },
    select: { title: true, compressedSummary: true, compressedAt: true },
  });
  if (!chat) return null;

  // Messages before the summary are already folded into it.
  const where = {
    conversationId: id,
    ...(chat.compressedAt ? { createdAt: { gte: chat.compressedAt } } : {}),
  };
  const [newest, total] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: MAX_READ_MESSAGES,
      select: { role: true, content: true, parts: true },
    }),
    prisma.message.count({ where }),
  ]);

  const source = `past chat "${titleForHeader(chat.title)}"`;
  newest.reverse();
  const render = (room: number) => {
    // A long summary may take at most half the room, so the newest message still fits.
    const header = chat.compressedSummary
      ? `Summary of earlier messages:\n${cutTokens(chat.compressedSummary, Math.floor(room / 2))}`
      : "";
    return renderTranscript(newest, { budgetTokens: room, header, total }).text;
  };

  // The fence grows with backtick runs in the text, so measure the framed result and
  // shave the room by the excess until it fits.
  let room = Math.max(budgetTokens - countTokens(quotePastChat(source, "")), 0);
  let text = render(room);
  for (let i = 0; i < 5; i++) {
    const excess = countTokens(quotePastChat(source, text)) - budgetTokens;
    if (excess <= 0) break;
    room = Math.max(room - excess, 0);
    text = render(room);
  }
  return quotePastChat(source, text);
}
