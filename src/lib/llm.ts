import { getModel, listModels, type ModelConfig } from "@/lib/models";
import { resolveProviderCreds } from "@/lib/apiKeys";

/** A usable model for a server-side utility call, from this user's providers. Falls back to
 *  a tool-capable local model, then any model, mirroring /api/chat's default selection. */
export async function resolveModel(
  preferredId: string | undefined,
  userId: string,
): Promise<ModelConfig> {
  const creds = await resolveProviderCreds(userId);

  if (preferredId) {
    try {
      return getModel(preferredId, creds);
    } catch {
      // fall through to default selection
    }
  }

  const { models } = await listModels(creds);
  if (models.length === 0) throw new Error("No models available");
  const ollama = models.filter((m) => m.id.startsWith("ollama/"));
  if (ollama.length > 0) {
    return ollama.find((m) => m.supportsTools) || ollama[0];
  }
  return models.find((m) => m.supportsTools) || models[0];
}
