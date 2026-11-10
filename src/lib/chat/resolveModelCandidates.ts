import { initializeOllamaModels, listModels, type ProviderCreds } from "@/lib/models";
import { providerForModel } from "@/lib/providers";
import { resolveProviderCreds } from "@/lib/apiKeys";
import { canUseHostTools } from "@/lib/hostAccess";

export interface ResolveModelCandidatesOptions {
  requestedModel: string | undefined;
  fallbackModel: string | undefined;
  userId: string;
}

export type ResolveModelCandidatesResult =
  | { ok: true; model: string; candidateModels: string[]; creds: ProviderCreds }
  | { ok: false; missingKeyProvider: string };

/** Resolves this user's creds, defaults the model when unrequested, and builds the fallback
 *  chain: primary model, conversation fallback, then VAS_FALLBACK_MODEL. */
export async function resolveModelCandidates(
  opts: ResolveModelCandidatesOptions,
): Promise<ResolveModelCandidatesResult> {
  const creds = await resolveProviderCreds(opts.userId);

  let model = opts.requestedModel;
  if (!model) {
    const { models } = await listModels(creds, await canUseHostTools(opts.userId));
    const ollamaModels = models.filter((m) => m.id.startsWith("ollama/"));
    if (ollamaModels.length > 0) {
      model = (ollamaModels.find((m) => m.supportsTools) || ollamaModels[0]).id;
    } else if (models.length > 0) {
      model = models[0].id;
    } else {
      throw new Error("No models available");
    }
  } else {
    // getModel() for an Ollama id needs the tag cache warm.
    await initializeOllamaModels();
  }

  const def = providerForModel(model);
  if (def && !creds[def.id]) {
    return { ok: false, missingKeyProvider: def.label };
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

  return { ok: true, model, candidateModels, creds };
}
