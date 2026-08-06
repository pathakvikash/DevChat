import {
  getModel,
  getAllModels,
  initializeOllamaModels,
  initializeOpenRouterModels,
  initializeNvidiaNimModels,
  type ModelConfig,
} from "@/lib/models";
import { resolveOpenRouterKey, resolveNvidiaNimKey } from "@/lib/apiKeys";

/**
 * Ensures every configured provider's model catalogue is loaded. Safe to call
 * repeatedly — the underlying initializers are idempotent and cheap once warm.
 *
 * Keys usually live in per-user settings rather than env. Without passing them
 * through, requests go out with no Authorization header.
 */
async function ensureModelsInitialized(userId?: string): Promise<void> {
  await initializeOllamaModels();
  const [openRouterKey, nvidiaNimKey] = userId
    ? await Promise.all([resolveOpenRouterKey(userId), resolveNvidiaNimKey(userId)])
    : [process.env.OPENROUTER_API_KEY, process.env.NVIDIA_NIM_API_KEY];
  if (openRouterKey) await initializeOpenRouterModels(openRouterKey);
  if (nvidiaNimKey) await initializeNvidiaNimModels(nvidiaNimKey);
}

/**
 * Resolve a usable model for a server-side utility call (planning, self-eval,
 * memory consolidation). Falls back to a tool-capable local model,
 * then any available model, mirroring the default-selection logic in
 * /api/chat so behavior is consistent across the app.
 */
export async function resolveModel(
  preferredId?: string,
  userId?: string,
): Promise<ModelConfig> {
  await ensureModelsInitialized(userId);

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
