import { encode } from "gpt-tokenizer";
import type { SystemPromptSections } from "./chat/buildSystemPrompt";

export interface TokenCountResult {
  usedTokens: number;
  maxContextTokens: number;
  contextPercent: number;
}

export interface TokenBreakdown {
  systemPrompt: number;
  conversationHistory: number;
  currentMessage: number;
  total: number;
}

/** Per-category breakdown used by the Context Details panel. Every
 *  category is the token count of the actual text the model sees in
 *  that bucket, not an estimate of overhead. */
export interface DetailedTokenBreakdown {
  base: number;
  persona: number;
  skills: number;
  tools: number;
  memory: number;
  compressed: number;
  kb: number;
  conversationHistory: number;
  currentMessage: number;
  total: number;
  sections: {
    base: string;
    persona: string | null;
    skills: string | null;
    tools: string | null;
    memory: string | null;
    compressed: string | null;
    kb: string | null;
  };
}

export function countTokens(text: string): number {
  if (!text || text.trim().length === 0) return 0;
  try {
    return encode(text).length;
  } catch {
    return estimateTokens(text);
  }
}

export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.ceil(words * 1.3);
}

export async function calculateContextUsage(
  model: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  currentMessage: string,
  contextLength: number,
  compressedSummary?: string | null
): Promise<TokenCountResult & { breakdown: TokenBreakdown }> {
  const systemTokens = countTokens(systemPrompt);

  // If compressed summary exists, use it instead of full history
  let historyTokens: number;

  if (compressedSummary && compressedSummary.trim().length > 0) {
    historyTokens = countTokens(`[Compressed History]: ${compressedSummary}`);
  } else {
    historyTokens = countTokens(messages.map((m) => `${m.role}: ${m.content}`).join("\n"));
  }

  const currentTokens = countTokens(currentMessage);

  const total = systemTokens + historyTokens + currentTokens;
  const percent = Math.min(100, Math.round((total / contextLength) * 100));

  return {
    usedTokens: total,
    maxContextTokens: contextLength,
    contextPercent: percent,
    breakdown: {
      systemPrompt: systemTokens,
      conversationHistory: historyTokens,
      currentMessage: currentTokens,
      total,
    },
  };
}

/** Per-category token counter. The chat route and the context endpoint
 *  both produce the same numbers because both feed in the actual
 *  `SystemPromptSections` that gets sent to the model (or would be,
 *  in the context-panel case). */
export function calculateDetailedContextUsage(
  sections: SystemPromptSections,
  messages: Array<{ role: string; content: string }>,
  currentMessage: string,
  contextLength: number,
  compressedSummary?: string | null,
): TokenCountResult & { breakdown: DetailedTokenBreakdown } {
  const base = countTokens(sections.base);
  const persona = sections.persona ? countTokens(sections.persona) : 0;
  const skills = sections.skills ? countTokens(sections.skills) : 0;
  const tools = sections.tools ? countTokens(sections.tools) : 0;
  const memory = sections.memory ? countTokens(sections.memory) : 0;
  const compressed =
    sections.compressed && sections.compressed.trim().length > 0
      ? countTokens(sections.compressed)
      : compressedSummary && compressedSummary.trim().length > 0
        ? countTokens(`--- Compressed Conversation History ---\n${compressedSummary}`)
        : 0;
  const kb = sections.kb ? countTokens(sections.kb) : 0;

  let historyTokens: number;
  if (compressed > 0) {
    historyTokens = 0;
  } else {
    historyTokens = countTokens(
      messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
    );
  }

  const currentTokens = countTokens(currentMessage);

  const total =
    base +
    persona +
    skills +
    tools +
    memory +
    compressed +
    kb +
    historyTokens +
    currentTokens;

  const percent = Math.min(100, Math.round((total / contextLength) * 100));

  return {
    usedTokens: total,
    maxContextTokens: contextLength,
    contextPercent: percent,
    breakdown: {
      base,
      persona,
      skills,
      tools,
      memory,
      compressed,
      kb,
      conversationHistory: historyTokens,
      currentMessage: currentTokens,
      total,
      sections: {
        base: sections.base,
        persona: sections.persona,
        skills: sections.skills,
        tools: sections.tools,
        memory: sections.memory,
        compressed: sections.compressed,
        kb: sections.kb,
      },
    },
  };
}

export function getContextStatus(percent: number): "healthy" | "warning" | "critical" {
  if (percent >= 85) return "critical";
  if (percent >= 60) return "warning";
  return "healthy";
}
