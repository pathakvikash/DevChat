import { initializeOllamaModels, listModels, type ProviderCreds } from "@/lib/models";
import { rankDefaultModels } from "@/lib/defaultModel";
import { getSettingsKey } from "@/lib/settings";
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
  const defaults: string[] = [];
  if (!model) {
    const { models } = await listModels(creds, await canUseHostTools(opts.userId));
    // The server's own list only: a saved bridge model is the browser's, not ours to call.
    defaults.push(...rankDefaultModels(await getSettingsKey(opts.userId, "defaultModel"), models, false).slice(0, 3).map((m) => m.id));
    if (!defaults[0]) throw new Error("No models available");
    model = defaults[0];
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
  defaults.forEach(pushCandidate); // no model asked for: the next best ones, in case the first is rejected
  pushCandidate(opts.fallbackModel);
  pushCandidate(process.env.VAS_FALLBACK_MODEL);

  return { ok: true, model, candidateModels, creds };
}
