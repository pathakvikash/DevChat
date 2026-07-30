const AUTH_ERROR_PATTERN = /401|403|unauthorized|api.key|incorrect|invalid|no api key|auth/i;
const TRANSIENT_ERROR_PATTERN =
  /rate.?limit|429|too many requests|timeout|timed? out|etimedout|econnreset|econnrefused|503|502|500 |temporarily unavailable|overloaded|fetch failed|network|socket|upstream/i;

export function isTransientProviderError(msg: string): boolean {
  return TRANSIENT_ERROR_PATTERN.test(msg);
}

export function formatMissingApiKeyMessage(provider: "OpenRouter" | "NVIDIA NIM"): string {
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
  if (!AUTH_ERROR_PATTERN.test(rawMsg)) return null;
  const provider = opts.servedModel.startsWith("openrouter/") ? "OpenRouter" : "NVIDIA NIM";
  return formatMissingApiKeyMessage(provider);
}
