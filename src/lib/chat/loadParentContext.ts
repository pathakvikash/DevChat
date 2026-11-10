import { prisma } from "@/lib/db";
import { liveSince } from "@/lib/liveSince";
import { countTokens, cutTokens } from "@/lib/tokens";
import { renderTranscript } from "@/lib/chat/renderTranscript";
import { budgetTokens } from "@/lib/chat/contextBudget";
import { quotePastChat, titleForHeader } from "@/lib/chat/quotePastChat";

/** Share of the side chat's window the main-chat section may use, and its hard cap. */
const MAIN_SHARE = 0.25;
const MAIN_CAP = 6000;
/** Newest live messages loaded; the token budget trims further. */
const MAX_MESSAGES = 200;
const SUMMARY_LABEL = "Summary of earlier messages:\n";
/** Tokens kept back for the "Showing the last N of M" note and the separators between parts. */
const NOTE_RESERVE = 24;

const INTRO = [
  "--- Main conversation (read-only) ---",
  "You are a side chat next to the user's main chat. Below is the main chat as last saved.",
  'You cannot change it. To suggest something for it, write it so the user can use "Send to main".',
].join("\n");

export interface MainContext {
  /** The whole "Main conversation" section, framed as reference data. */
  text: string;
  /** Messages that fit in the section, and the main chat's live message count. */
  shown: number;
  total: number;
}

/**
 * The main chat as its own view shows it (summary, messages since the summary, folder, todos,
 * artifact titles only), trimmed to the side chat's window. Null unless `sideId` is a side chat
 * whose parent belongs to `userId`.
 */
export async function loadParentContext(
  sideId: string,
  userId: string,
  contextWindow: number,
): Promise<MainContext | null> {
  const side = await prisma.conversation.findUnique({
    where: { id: sideId },
    select: {
      kind: true,
      parent: {
        select: {
          id: true,
          userId: true,
          title: true,
          workingFolder: true,
          compressedSummary: true,
          compressedAt: true,
          todos: { select: { title: true, status: true }, orderBy: { order: "asc" } },
          artifacts: { select: { title: true, type: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  const parent = side?.kind === "side" ? side.parent : null;
  if (!parent || parent.userId !== userId) return null;

  const live = liveSince(parent.compressedAt).where;
  const where = { conversationId: parent.id, ...live };
  const [newest, total] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: MAX_MESSAGES,
      select: { role: true, content: true, parts: true },
    }),
    prisma.message.count({ where }),
  ]);
  newest.reverse();

  const source = `the main chat "${titleForHeader(parent.title)}"`;
  const budget = budgetTokens(contextWindow, MAIN_SHARE, MAIN_CAP);
  const section = (body: string) => `${INTRO}\n\n${quotePastChat(source, body)}`;
  // The fence and framing cost tokens too. What is left is shared: the summary first, whole
  // unless it alone exceeds that room; then the folder and lists; the newest messages get the rest.
  const room = Math.max(budget - countTokens(section("")) - NOTE_RESERVE, 0);
  const folderLine = `Working folder: ${parent.workingFolder || "none"}`;
  const summaryRoom = Math.max(room - countTokens(`${folderLine}\n${SUMMARY_LABEL}`), 0);
  const summary = parent.compressedSummary ? SUMMARY_LABEL + cutTokens(parent.compressedSummary, summaryRoom) : "";
  const metaRoom = Math.max(room - countTokens(`${folderLine}\n${summary}`), 0);
  const header = [
    folderLine,
    summary,
    parent.todos.length
      ? `Todos: ${cutTokens(parent.todos.map((t) => `[${t.status}] ${t.title}`).join(" · "), Math.floor(metaRoom / 2))}`
      : "",
    parent.artifacts.length
      ? `Artifacts: ${cutTokens(parent.artifacts.map((a) => `"${a.title}" (${a.type})`).join(", "), Math.floor(metaRoom / 2))}`
      : "",
    newest[newest.length - 1]?.role === "user"
      ? "The main chat has not saved a reply to the last message yet; it may still be working."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Header lines are kept by renderTranscript, so it only has the messages' share to trim.
  let shown = renderTranscript(newest, { budgetTokens: room, header, total });
  for (let i = 0; i < 5; i++) {
    const excess = countTokens(section(shown.text)) - budget;
    if (excess <= 0) break;
    shown = renderTranscript(newest, { budgetTokens: Math.max(room - excess, 0), header, total });
  }
  return { text: section(shown.text), shown: shown.shown, total: shown.total };
}
