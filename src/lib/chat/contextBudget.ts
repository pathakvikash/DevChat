/** What Ollama gets when the chat sets no `num_ctx`: the trained window (128K on many models) would cost GiBs of KV cache.
 *  The dynamic bump in the chat route (contextManager) can raise it from here. */
export const OLLAMA_DEFAULT_CTX = 8192;

/** A model's usable context window: Ollama's per-chat `num_ctx` override first, else the catalog value
 *  (capped at OLLAMA_DEFAULT_CTX for Ollama). This is also the `num_ctx` that is sent. */
export function contextWindowFor(
  modelId: string,
  modelConfig: { contextWindow: number } | null,
  contextLength?: number | null,
): number {
  const catalog = modelConfig?.contextWindow || 8192;
  return modelId.startsWith("ollama/") ? contextLength || Math.min(catalog, OLLAMA_DEFAULT_CTX) : catalog;
}

/** Tokens a piece of pulled-in text may use: `share` of the window, never above `cap`. */
export function budgetTokens(window: number, share: number, cap?: number): number {
  const tokens = Math.floor(window * share);
  return cap === undefined ? tokens : Math.min(tokens, cap);
}
