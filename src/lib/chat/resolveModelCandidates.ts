import {
  initializeOllamaModels,
  initializeOpenRouterModels,
  initializeNvidiaNimModels,
  getAllModels,
} from "@/lib/models";
import { resolveOpenRouterKey, resolveNvidiaNimKey } from "@/lib/apiKeys";

export interface ResolveModelCandidatesOptions {
  requestedModel: string | undefined;
  fallbackModel: string | undefined;
  bodyOpenrouterApiKey: string | undefined;
  bodyNvidiaNimApiKey: string | undefined;
}

export type ResolveModelCandidatesResult =
  | { ok: true; model: string; candidateModels: string[] }
  | { ok: false; missingKeyProvider: "OpenRouter" | "NVIDIA NIM" };

/**
 * Initializes Ollama/OpenRouter/NVIDIA NIM providers, picks a default model
 * when none was requested, and builds the candidate fallback chain (primary
 * model, conversation fallback, VAS_FALLBACK_MODEL env var).
 */
export async function resolveModelCandidates(
  opts: ResolveModelCandidatesOptions,
): Promise<ResolveModelCandidatesResult> {
  await initializeOllamaModels();
  const effectiveOrKey = await resolveOpenRouterKey(opts.bodyOpenrouterApiKey);
  const effectiveNimKey = await resolveNvidiaNimKey(opts.bodyNvidiaNimApiKey);
  if (effectiveOrKey) {
    await initializeOpenRouterModels(effectiveOrKey);
  }
  if (effectiveNimKey) {
    await initializeNvidiaNimModels(effectiveNimKey);
  }

  let model = opts.requestedModel;
  if (!model) {
    const allModels = getAllModels();
    const ollamaModels = allModels.filter((m) => m.id.startsWith("ollama/"));
    if (ollamaModels.length > 0) {
      const toolModels = ollamaModels.filter((m) => m.supportsTools);
      model = (toolModels[0] || ollamaModels[0]).id;
    } else if (allModels.length > 0) {
      model = allModels[0].id;
    } else {
      throw new Error("No models available");
    }
  }

  if (
    (model.startsWith("openrouter/") && !effectiveOrKey) ||
    (model.startsWith("nvidia-nim/") && !effectiveNimKey)
  ) {
    return {
      ok: false,
      missingKeyProvider: model.startsWith("openrouter/") ? "OpenRouter" : "NVIDIA NIM",
    };
  }

  // ── Candidate model chain (primary + fallback) ─────────────────────────
  // If the primary model fails (auth error, rate limit, outage, removed id),
  // retry it with backoff, then fall back to the conversation's fallbackModel
  // (or the VAS_FALLBACK_MODEL env var) before giving up.
  const candidateModels: string[] = [];
  const pushCandidate = (m?: string) => {
    if (m && !candidateModels.includes(m)) candidateModels.push(m);
  };
  pushCandidate(model);
  pushCandidate(opts.fallbackModel);
  pushCandidate(process.env.VAS_FALLBACK_MODEL);

  return { ok: true, model, candidateModels };
}
