import {
  getModel,
  getAllModels,
  initializeOllamaModels,
  initializeOpenRouterModels,
  initializeNvidiaNimModels,
  type ModelConfig,
} from "@/lib/models";

/**
 * Ensures every configured provider's model catalogue is loaded. Safe to call
 * repeatedly — the underlying initializers are idempotent and cheap once warm.
 */
async function ensureModelsInitialized(): Promise<void> {
  await initializeOllamaModels();
  if (process.env.OPENROUTER_API_KEY) await initializeOpenRouterModels();
  if (process.env.NVIDIA_NIM_API_KEY) await initializeNvidiaNimModels();
}

/**
 * Resolve a usable model for a server-side utility call (planning, self-eval,
 * memory consolidation, goal cycles). Falls back to a tool-capable local model,
 * then any available model, mirroring the default-selection logic in
 * /api/chat so behavior is consistent across the app.
 */
export async function resolveModel(preferredId?: string): Promise<ModelConfig> {
  await ensureModelsInitialized();

  if (preferredId) {
    try {
      return getModel(preferredId);
    } catch {
      // fall through to default selection
    }
  }

  const all = getAllModels();
  if (all.length === 0) throw new Error("No models available");
  const ollama = all.filter((m) => m.id.startsWith("ollama/"));
  if (ollama.length > 0) {
    const toolCapable = ollama.filter((m) => m.supportsTools);
    return toolCapable[0] || ollama[0];
  }
  // Prefer a tool-capable model when picking from cloud providers too.
  return all.find((m) => m.supportsTools) || all[0];
}
