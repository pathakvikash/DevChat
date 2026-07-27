import { generateText } from "ai";
import { getModel, initializeOllamaModels } from "@/lib/models";
import { prisma } from "@/lib/db";
import { countTokens } from "@/lib/tokens";

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
}

export async function compressConversation(
  conversationId: string,
  modelId: string = DEFAULT_COMPACTION_MODEL,
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

  const modelConfig = getModel(modelId);
  const isOllama = modelId.startsWith("ollama/");

  const MAX_COMPRESSION_TOKENS = 4000;

  let conversationText = conversation.messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  let beforeTokens = countTokens(conversationText);

  if (beforeTokens > MAX_COMPRESSION_TOKENS) {
    const lineItems = conversation.messages.map(
      (m) => `${m.role.toUpperCase()}: ${m.content}`,
    );
    while (lineItems.length > 1) {
      lineItems.shift();
      conversationText = lineItems.join("\n\n");
      beforeTokens = countTokens(conversationText);
      if (beforeTokens <= MAX_COMPRESSION_TOKENS) break;
    }
  }

  const prompt = `Summarize this conversation for context preservation:\n\n${conversationText}`;
  const beforeMessages = conversation.messages.length;

  try {
    const result = await generateText({
      model: modelConfig.model,
      system: COMPRESSION_SYSTEM_PROMPT,
      prompt,
      temperature: 0.3,
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
  }
): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      compressedSummary: summary,
      compressedAt: new Date(),
      compressedBeforeTokens: stats?.beforeTokens,
      compressedAfterTokens: stats?.afterTokens,
      compressedBeforeMessages: stats?.beforeMessages,
    },
  });
}

export async function shouldAutoCompress(
  conversationId: string,
  thresholdPercent: number = 85
): Promise<boolean> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { model: true, systemPrompt: true },
  });

  if (!conversation) return false;

  // Use the base dynamic tier (4096) regardless of any inflated contextLength
  // from dynamic context management. Dynamic increases push contextUsage to
  // well below the threshold, making auto-compress never fire.
  const contextLength = 4096;
  const { calculateContextUsage } = await import("@/lib/tokens");

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  const result = await calculateContextUsage(
    conversation.model,
    conversation.systemPrompt || "",
    messages,
    "",
    contextLength
  );

  return result.contextPercent >= thresholdPercent;
}
