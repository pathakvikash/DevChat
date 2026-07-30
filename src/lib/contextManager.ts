import { countTokens } from "@/lib/tokens";

const CONTEXT_TIERS = [4096, 8192, 16384, 32768] as const;
const MAX_DYNAMIC_CTX = 32768;
const INCREASE_THRESHOLD = 0.8;

export function getNextContextTier(current: number): number | null {
  for (const t of CONTEXT_TIERS) {
    if (t > current) return t;
  }
  return null;
}

export function estimatePromptTokens(
  systemPrompt: string,
  messages: any[],
  toolCount: number,
): number {
  let total = countTokens(systemPrompt);

  for (const msg of messages) {
    if (msg.content && typeof msg.content === "string") {
      total += countTokens(msg.content);
    }
    if (msg.parts && Array.isArray(msg.parts)) {
      for (const p of msg.parts) {
        if (p.type === "text" && p.text) {
          total += countTokens(p.text);
        }
      }
    }
  }

  // Rough overhead for tool schemas the AI SDK serializes separately
  if (toolCount > 0) {
    total += 500;
  }

  return total;
}

export function shouldIncreaseContext(
  promptTokens: number,
  currentWindow: number,
): boolean {
  if (currentWindow >= MAX_DYNAMIC_CTX) return false;
  return promptTokens / currentWindow >= INCREASE_THRESHOLD;
}
