/** A model's usable context window: Ollama's per-chat `num_ctx` override first, else the catalog value. */
export function contextWindowFor(
  modelId: string,
  modelConfig: { contextWindow: number } | null,
  contextLength?: number | null,
): number {
  const catalog = modelConfig?.contextWindow || 8192;
  return modelId.startsWith("ollama/") ? contextLength || catalog : catalog;
}

/** Tokens a piece of pulled-in text may use: `share` of the window, never above `cap`. */
export function budgetTokens(window: number, share: number, cap?: number): number {
  const tokens = Math.floor(window * share);
  return cap === undefined ? tokens : Math.min(tokens, cap);
}
