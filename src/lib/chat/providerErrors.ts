import { isCliModelId, providerForModel } from "@/lib/providers";

const AUTH_ERROR_PATTERN = /401|403|unauthorized|api.key|incorrect|invalid|no api key|auth/i;
const TRANSIENT_ERROR_PATTERN =
  /rate.?limit|429|too many requests|timeout|timed? out|etimedout|econnreset|econnrefused|503|502|500 |temporarily unavailable|overloaded|fetch failed|network|socket|upstream/i;

// A model the provider no longer serves (a free tier ended, an id was retired): another model fixes it, a retry does not.
// Only real provider signals: an error code, OpenRouter's messages, OpenAI's "The model `x` does not exist", or a 404 about the model.
// Not a loose "model ... not found": a 400 about a missing tool or file can mention the model too.
const MODEL_UNAVAILABLE_PATTERN =
  /model_not_found|unavailable for free|no endpoints found|is not a valid model id|the model [`'"]?[\w./:@-]+[`'"]? does not exist|\b404\b[\s\S]{0,120}\bmodels?\b|\bmodels?\b[\s\S]{0,120}\b404\b/i;
export const MODEL_UNAVAILABLE_MESSAGE = "This model is not available from its provider right now. Pick another model from the model picker and send again.";

// The provider account has no credits (HTTP 402, OpenRouter): another model may be cheaper or free, a retry is not.
const CREDITS_PATTERN = /^\s*402\b|"code":\s*402\b|\bstatus(?: code)?:?\s*402\b|payment required|insufficient credits|requires more credits/i;
export const CREDITS_MESSAGE = "This model needs credits on your provider account. Add credits, or pick another model from the model picker and send again.";

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
  // CLI-backed models (claude-code/…, opencode/…) report their own login and model problems verbatim.
  if (opts.isOllama || isCliModelId(opts.servedModel)) return null;
  // Before the auth check: "not a valid model" would otherwise read as a bad key.
  if (MODEL_UNAVAILABLE_PATTERN.test(rawMsg)) return MODEL_UNAVAILABLE_MESSAGE;
  // A 401/403 is an auth failure even if its text also says "Payment Required" or carries a stray 402.
  if (!/\b40[13]\b/.test(rawMsg) && CREDITS_PATTERN.test(rawMsg)) return CREDITS_MESSAGE;
  if (!AUTH_ERROR_PATTERN.test(rawMsg)) return null;
  // Only keyed (hosted) providers have a key to add; CLI-backed models
  // (claude-code/…, opencode/…) report their own login problems verbatim.
  const provider = providerForModel(opts.servedModel);
  if (!provider) return null;
  return formatMissingApiKeyMessage(provider.label);
}
