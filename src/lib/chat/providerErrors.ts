import { providerForModel } from "@/lib/providers";

const AUTH_ERROR_PATTERN = /401|403|unauthorized|api.key|incorrect|invalid|no api key|auth/i;
const TRANSIENT_ERROR_PATTERN =
  /rate.?limit|429|too many requests|timeout|timed? out|etimedout|econnreset|econnrefused|503|502|500 |temporarily unavailable|overloaded|fetch failed|network|socket|upstream/i;

// A model the provider no longer serves (a free tier ended, an id was retired): another model fixes it, a retry does not.
const MODEL_UNAVAILABLE_PATTERN =
  /unavailable for free|model_not_found|model[^.\n]{0,80}\b(is unavailable|not available|no longer available|not found|does not exist|has been (deprecated|retired|removed)|is not a valid model)|not a valid model/i;
export const MODEL_UNAVAILABLE_MESSAGE = "This model is not available from its provider right now. Pick another model from the model picker and send again.";

export function isTransientProviderError(msg: string): boolean {
  return TRANSIENT_ERROR_PATTERN.test(msg);
}

export function formatMissingApiKeyMessage(provider: string): string {
  return `Add your ${provider} API key in Settings to start chatting.`;
}

/**
 * Maps a raw provider/stream error to a user-actionable message when it looks
 * like an auth/invalid-key failure. Returns null when the error doesn't match
 * (Ollama errors are never auth-related here, since there's no API key to add).
 */
export function friendlyProviderErrorMessage(
  rawMsg: string,
  opts: { servedModel: string; isOllama: boolean },
): string | null {
  if (opts.isOllama) return null;
  // Before the auth check: "not a valid model" would otherwise read as a bad key.
  if (MODEL_UNAVAILABLE_PATTERN.test(rawMsg)) return MODEL_UNAVAILABLE_MESSAGE;
  if (!AUTH_ERROR_PATTERN.test(rawMsg)) return null;
  // Only keyed (hosted) providers have a key to add; CLI-backed models
  // (claude-code/…, opencode/…) report their own login problems verbatim.
  const provider = providerForModel(opts.servedModel);
  if (!provider) return null;
  return formatMissingApiKeyMessage(provider.label);
}
