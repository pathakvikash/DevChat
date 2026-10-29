import { generateText } from "ai";
import { getModel, initializeOllamaModels } from "@/lib/models";
import { resolveProviderCreds } from "@/lib/apiKeys";
import { prisma } from "@/lib/db";
import { countTokens } from "@/lib/tokens";
import { liveSince } from "@/lib/liveSince";
import { isSanityMode } from "@/lib/sanityMode";

/**
 * Default model used for compaction. Picked to be a small, fast local model
 * (Ollama) so summarizing doesn't compete with the active chat model for
 * latency/cost. Callers may pass a different id via the second argument
 * to `compressConversation`.
 */
export const DEFAULT_COMPACTION_MODEL = "ollama/gemma3:4b";

const COMPRESSION_SYSTEM_PROMPT = `You are a conversation summarizer. Produce a concise, well-structured markdown summary of the conversation that preserves everything needed for future turns.

Hard rules:
- Keep it short: target 250-450 tokens, hard cap ~600.
- Use markdown sections and bullet points; no prose paragraphs.
- Preserve concrete facts the model must remember (names, numbers, paths, IDs, decisions, code snippets, user preferences).
- Drop pleasantries, hedging, and meta-commentary ("the user asked…", "as discussed…").
- Preserve the most recent user intent and any open questions / TODOs.

Output format (markdown only, no preamble):

### Goal
One sentence: what the user is trying to accomplish.

### Key facts
- … (bulleted, terse)

### Decisions & conclusions
- … (bulleted)

### Open questions / TODOs
- … (bulleted, or "None")

### Code & artifacts
- … (bulleted, only items the next turn will need; include the snippet if short)`;

export interface CompressionResult {
  summary: string;
  beforeTokens: number;
  afterTokens: number;
  beforeMessages: number;
  reductionTokens: number;
  reductionPercent: number;
  /** Last user message in the snapshot summarized: it and later messages stay live (see `liveSince`). */
  cutAt: Date | null;
}

/** `timeoutMs` bounds the model call, with no retries since a retry would only spend the
 *  deadline twice; without it the call keeps the default retries. `focus` steers the summary. */
export async function compressConversation(
  conversationId: string,
  modelId: string = DEFAULT_COMPACTION_MODEL,
  {
    focus,
    timeoutMs,
    abortSignal,
  }: { focus?: string; timeoutMs?: number; abortSignal?: AbortSignal } = {},
): Promise<CompressionResult | null> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true, createdAt: true },
      },
    },
  });

  if (!conversation || conversation.messages.length === 0) {
    return null;
  }

  // Initialize Ollama models before getting the model config
  await initializeOllamaModels();

  const effectiveModelId = isSanityMode() ? "mock/summary" : modelId; // sanity suite: never a real model
  const creds = conversation.userId ? await resolveProviderCreds(conversation.userId) : {};
  const modelConfig = getModel(effectiveModelId, creds);
  const isOllama = effectiveModelId.startsWith("ollama/");

  const MAX_COMPRESSION_TOKENS = 4000;

  // Rolling summary: the previous one first, then the messages since it that this round
  // drops (before the cut). The cut message and later ones stay live, so they are not
  // summarized too. Over the cap the oldest messages go first, never the summary.
  const cutAt = conversation.messages.findLast((m) => m.role === "user")?.createdAt ?? null;
  const sincePrevious = liveSince(conversation.compressedAt).isLive;
  const keptLive = liveSince(cutAt).isLive;
  const earlier = conversation.compressedSummary
    ? `Earlier summary:\n${conversation.compressedSummary}`
    : "";
  const lineItems = conversation.messages
    .filter((m) => sincePrevious(m) && !keptLive(m))
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`);
  if (lineItems.length === 0) return null;
  const joinText = () => [earlier, ...lineItems].filter(Boolean).join("\n\n");

  let conversationText = joinText();
  let beforeTokens = countTokens(conversationText);
  while (beforeTokens > MAX_COMPRESSION_TOKENS && lineItems.length > 1) {
    lineItems.shift();
    conversationText = joinText();
    beforeTokens = countTokens(conversationText);
  }

  const focusText = focus?.trim().slice(0, 500);
  const prompt =
    `Summarize this conversation for context preservation:\n\n${conversationText}` +
    (focusText ? `\n\nPay special attention to: ${focusText}` : "");
  const beforeMessages = lineItems.length;
  const timeoutSignal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
  const signal =
    timeoutSignal && abortSignal
      ? AbortSignal.any([timeoutSignal, abortSignal])
      : (timeoutSignal ?? abortSignal);

  try {
    const result = await generateText({
      model: modelConfig.model,
      system: COMPRESSION_SYSTEM_PROMPT,
      prompt,
      temperature: 0.3,
      abortSignal: signal,
      maxRetries: timeoutMs ? 0 : undefined,
      ...(isOllama ? { providerOptions: { ollama: { num_predict: 2048, temperature: 0.3 } } } : {}),
    });

    if (!result.text || result.text.trim().length === 0) {
      console.error("Compression returned empty result");
      return null;
    }

    const summary = result.text;
    // The summary is what actually gets sent into future prompts in place of
    // the full history, so the "after" cost is the summary itself.
    const afterTokens = countTokens(summary);
    const reductionTokens = Math.max(0, beforeTokens - afterTokens);
    const reductionPercent =
      beforeTokens > 0
        ? Math.round((reductionTokens / beforeTokens) * 100)
        : 0;

    return {
      summary,
      beforeTokens,
      afterTokens,
      beforeMessages,
      reductionTokens,
      reductionPercent,
      cutAt,
    };
  } catch (error) {
    console.error("Failed to compress conversation:", error);
    return null;
  }
}

export async function getCompressedContext(
  conversationId: string
): Promise<string | null> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { compressedSummary: true },
  });
  return conversation?.compressedSummary || null;
}

export async function saveCompressedSummary(
  conversationId: string,
  summary: string,
  stats?: {
    beforeTokens?: number;
    afterTokens?: number;
    beforeMessages?: number;
  },
  cutAt?: Date | null,
): Promise<void> {
  const data = {
    compressedSummary: summary,
    compressedBeforeTokens: stats?.beforeTokens,
    compressedAfterTokens: stats?.afterTokens,
    compressedBeforeMessages: stats?.beforeMessages,
  };

  if (!cutAt) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { ...data, compressedAt: new Date() },
    });
    return;
  }

  // The cut point from the summarized snapshot: the last exchange stays visible and in
  // context, and a save that lands late can't hide messages sent since.
  await prisma.conversation.updateMany({
    where: {
      id: conversationId,
      OR: [{ compressedAt: null }, { compressedAt: { lte: cutAt } }],
    },
    data: { ...data, compressedAt: cutAt },
  });
}

export async function shouldAutoCompress(
  conversationId: string,
  thresholdPercent: number,
  contextWindow: number,
): Promise<boolean> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { model: true, systemPrompt: true, compressedAt: true, compressedSummary: true },
  });

  if (!conversation) return false;

  const { calculateContextUsage } = await import("@/lib/tokens");

  // After a compression the live prompt is the summary plus messages from compressedAt on.
  const messages = await prisma.message.findMany({
    where: { conversationId, ...liveSince(conversation.compressedAt).where },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });
  // Compressing cuts at the newest user message, so it only helps if an older one exists to drop.
  if (messages.filter((m) => m.role === "user").length < 2) return false;
  const systemPrompt = [conversation.systemPrompt, conversation.compressedSummary]
    .filter(Boolean)
    .join("\n\n");

  const result = await calculateContextUsage(
    conversation.model,
    systemPrompt,
    messages,
    "",
    contextWindow
  );

  return result.contextPercent >= thresholdPercent;
}
