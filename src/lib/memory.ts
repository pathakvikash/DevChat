import { generateText } from "ai";
import { prisma } from "./db";
import { resolveModel } from "./llm";
import { extractJson } from "./utils/json";
import { extractText } from "./utils/messageParts";

/** Max facts surfaced into a single prompt. Memory can grow unbounded on disk,
 *  but the prompt block stays focused on the most salient facts. */
const MAX_MEMORIES_IN_PROMPT = 40;

/**
 * Salience score for ranking which memories make it into the prompt and which
 * survive pruning. Combines durable confidence, how often the fact has proven
 * useful (useCount), and recency of use. Higher = more important.
 * Pinned facts always get max salience.
 */
function salience(m: {
  confidence: number;
  useCount: number;
  lastUsedAt: Date | null;
  updatedAt: Date;
  pinned: boolean;
  now: number;
}): number {
  if (m.pinned) return Infinity;
  const ageDays =
    (m.now - (m.lastUsedAt ?? m.updatedAt).getTime()) / 86_400_000;
  const recency = Math.exp(-ageDays / 30);
  const usage = Math.log1p(m.useCount);
  return m.confidence * 1.5 + usage * 0.6 + recency * 0.8;
}

/**
 * Returns the most salient memories formatted as a system-prompt block, and
 * (fire-and-forget) reinforces the ones it surfaced — bumping useCount and
 * lastUsedAt so frequently-relevant facts rank higher and resist pruning.
 * This is the "memory improves over time" feedback loop on the read path.
 */
export async function getMemoryBlock(userId: string): Promise<string> {
  const memories = await prisma.memory.findMany({ where: { userId } });
  if (memories.length === 0) return "";

  const now = Date.now();
  const ranked = [...memories].sort(
    (a, b) =>
      salience({ ...b, now }) - salience({ ...a, now }),
  );
  const surfaced = ranked.slice(0, MAX_MEMORIES_IN_PROMPT);

  // Reinforce surfaced memories without blocking the response.
  const ids = surfaced.map((m) => m.id);
  prisma.memory
    .updateMany({
      where: { id: { in: ids } },
      data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
    })
    .catch(() => {});

  const byCategory: Record<string, typeof surfaced> = {};
  for (const m of surfaced) {
    (byCategory[m.category] ||= []).push(m);
  }

  const lines: string[] = [];
  for (const cat of Object.keys(byCategory).sort()) {
    lines.push(`[${cat}]`);
    for (const m of byCategory[cat]) {
      lines.push(`  ${m.key}: ${m.value}`);
    }
  }

  const omitted = memories.length - surfaced.length;
  const footer =
    omitted > 0
      ? `\n(+${omitted} less-relevant fact${omitted === 1 ? "" : "s"} not shown)`
      : "";

  return `--- USER MEMORY (persistent facts you've learned across conversations) ---
${lines.join("\n")}${footer}

When the user shares NEW facts about themselves (name, role, preferences, ongoing projects, things they want you to remember), call the \`rememberFact\` tool. When they tell you something is no longer true or to forget it, call \`forgetFact\`. Don't dump this list back at them — just use it to be more helpful.`;
}

interface ConsolidationOp {
  op: "upsert" | "forget";
  key: string;
  value?: string;
  category?: string;
  confidence?: number;
}

const CONSOLIDATION_SYSTEM = `You maintain a long-term memory of durable facts about a single user, learned from their conversations. Your job is to REVIEW a recent conversation against the existing memory and propose precise updates so the memory gets better over time.

Output ONLY a JSON array of operations, nothing else. Each operation is one of:
  {"op":"upsert","key":"snake_case_id","value":"the fact in one sentence","category":"profile|preference|project|context","confidence":0.0-1.0}
  {"op":"forget","key":"existing_key"}

Rules:
- Only record DURABLE facts: identity, role, stable preferences, ongoing projects, recurring goals, how the user wants you to behave. NEVER record one-off task details, transient state, or trivia.
- Reuse an existing key when refining/correcting a known fact (this MERGES and reinforces it). Invent a new snake_case key only for genuinely new facts.
- Use "forget" when the conversation shows an existing fact is now wrong or obsolete.
- confidence: 0.9+ if the user stated it explicitly, ~0.6 if strongly implied, <0.5 if a guess.
- If nothing durable was learned, output []. Prefer FEW high-quality operations over many noisy ones.`;

/**
 * Reviews a conversation and consolidates long-term memory: extracts durable
 * facts, MERGES/reinforces existing ones (raising confidence), corrects or
 * forgets obsolete ones, then applies time-decay + pruning of stale, low-value
 * facts. This is the "memory improves over time" loop on the write path.
 *
 * Safe to call fire-and-forget; never throws.
 */
export async function consolidateMemory(opts: {
  conversationId: string;
  userId: string;
  modelId?: string;
  maxMessages?: number;
}): Promise<{ applied: number; pruned: number }> {
  const { conversationId, userId, modelId, maxMessages = 20 } = opts;
  try {
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: maxMessages,
      select: { role: true, content: true, parts: true },
    });
    if (messages.length === 0) return { applied: 0, pruned: 0 };

    const transcript = messages
      .reverse()
      .map((m) => {
        const text =
          m.content ||
          extractText({ role: m.role, parts: safeParse(m.parts) }) ||
          "";
        return `${m.role.toUpperCase()}: ${text}`.slice(0, 1500);
      })
      .filter((l) => l.length > 6)
      .join("\n");

    const existing = await prisma.memory.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 60,
    });
    const existingBlock =
      existing.length > 0
        ? existing.map((m) => `- ${m.key} [${m.category}]: ${m.value}`).join("\n")
        : "(none yet)";

    const cfg = await resolveModel(modelId, userId);
    const { text } = await generateText({
      model: cfg.model,
      system: CONSOLIDATION_SYSTEM,
      prompt: `EXISTING MEMORY:\n${existingBlock}\n\nRECENT CONVERSATION:\n${transcript}\n\nReturn the JSON array of memory operations.`,
      temperature: 0.2,
    });

    const ops = extractJson<ConsolidationOp[]>(text, []);
    let applied = 0;
    const conflicts: string[] = [];
    if (Array.isArray(ops)) {
      for (const op of ops) {
        if (!op || typeof op.key !== "string") continue;
        const key = op.key.trim().slice(0, 80);
        if (!key) continue;
        if (op.op === "forget") {
          await prisma.memory.deleteMany({ where: { userId, key } });
          applied++;
        } else if (op.op === "upsert" && op.value) {
          const value = String(op.value).trim().slice(0, 2000);
          const category = (op.category || "context").trim().slice(0, 40);
          const conf = clamp(op.confidence ?? 0.6, 0.1, 1);
          const prev = await prisma.memory.findUnique({ where: { userId_key: { userId, key } } });
          // Conflict detection: if the same key gets a meaningfully different
          // value, flag it so the user can review.
          if (prev && prev.value !== value && !value.toLowerCase().includes(prev.value.toLowerCase()) && !prev.value.toLowerCase().includes(value.toLowerCase())) {
            conflicts.push(`"${key}": "${prev.value}" → "${value}"`);
          }
          const confidence = prev
            ? clamp(Math.max(prev.confidence, (prev.confidence + conf) / 2 + 0.05), 0.1, 1)
            : conf;
          await prisma.memory.upsert({
            where: { userId_key: { userId, key } },
            create: { userId, key, value, category, confidence, sourceConversationId: conversationId },
            update: { value, category, confidence, sourceConversationId: conversationId },
          });
          applied++;
        }
      }
    }
    if (conflicts.length > 0) {
      console.log("[memory] consolidation conflicts:", conflicts);
    }

    const pruned = await decayAndPrune(userId);
    return { applied, pruned };
  } catch (e) {
    console.error("[memory] consolidation failed:", e);
    return { applied: 0, pruned: 0 };
  }
}

/**
 * Time-decay: facts not used recently lose a little confidence; once a fact is
 * both low-confidence AND stale, it's pruned. Keeps memory from accumulating
 * stale noise as it grows.
 */
async function decayAndPrune(userId: string): Promise<number> {
  const now = Date.now();
  const all = await prisma.memory.findMany({ where: { userId } });
  let pruned = 0;
  for (const m of all) {
    if (m.pinned) continue;
    const ageDays = (now - (m.lastUsedAt ?? m.updatedAt).getTime()) / 86_400_000;
    if (ageDays < 14) continue; // only touch facts idle for 2+ weeks
    const decayed = clamp(m.confidence - 0.05, 0, 1);
    if (decayed < 0.25 && m.useCount < 2) {
      await prisma.memory.delete({ where: { id: m.id } }).catch(() => {});
      pruned++;
    } else if (decayed !== m.confidence) {
      await prisma.memory
        .update({ where: { id: m.id }, data: { confidence: decayed } })
        .catch(() => {});
    }
  }
  return pruned;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function safeParse(s: string | null): unknown {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
