// Registry of hosted LLM providers DevChat can talk to. Every entry speaks the
// OpenAI Chat Completions wire format, so one code path (`@ai-sdk/openai` with a
// custom baseURL) serves all of them and adding a provider is one more row.
//
// Pure data — safe to import from client components. Credential lookup lives
// in `apiKeys.ts`, model construction in `models.ts`.
//
// A model id is `<provider.id>/<upstream model id>`, e.g. `openai/gpt-4o`,
// `openrouter/meta-llama/llama-3.3-70b-instruct`. Ollama (`ollama/...`) is
// handled separately in models.ts because it is discovered, not keyed.

export interface ProviderDef {
  /** Model-id prefix and stable identifier. */
  id: string;
  /** Human label shown in the UI. */
  label: string;
  /** Env var holding the API key (server-wide fallback for every user). */
  envKey: string;
  /** Per-user AppSetting key holding the API key. */
  settingKey: string;
  /** OpenAI-compatible base URL. Omitted for `custom`, which is user-supplied. */
  baseUrl?: string;
  /** Env var overriding `baseUrl`. */
  envBaseUrl?: string;
  /** Per-user AppSetting key overriding `baseUrl` (custom endpoint only). */
  baseUrlSettingKey?: string;
  /** Endpoint works without a key (local LM Studio, vLLM, remote Ollama). */
  keyOptional?: boolean;
  /** Used when the provider's /models response has no context length. */
  defaultContextWindow: number;
  /** Every chat model from this provider accepts images. */
  vision?: boolean;
  /** Only list models priced at $0 (OpenRouter's catalog is mostly paid). */
  freeOnly?: boolean;
  /** Extra request headers, given the resolved key. */
  headers?: (apiKey: string) => Record<string, string>;
  placeholder: string;
  docsUrl?: string;
}

export const PROVIDERS: readonly ProviderDef[] = [
  {
    id: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    envBaseUrl: "OPENAI_BASE_URL",
    settingKey: "openaiApiKey",
    baseUrl: "https://api.openai.com/v1",
    defaultContextWindow: 128_000,
    vision: true,
    placeholder: "sk-...",
    docsUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    settingKey: "anthropicApiKey",
    // Anthropic's OpenAI SDK compatibility layer. `/v1/models` is native and
    // needs x-api-key + anthropic-version; the compat chat endpoint accepts
    // the Bearer header the SDK sends and ignores the extras.
    baseUrl: "https://api.anthropic.com/v1",
    defaultContextWindow: 200_000,
    vision: true,
    headers: (apiKey) => ({ "x-api-key": apiKey, "anthropic-version": "2023-06-01" }),
    placeholder: "sk-ant-...",
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google",
    label: "Google Gemini",
    envKey: "GOOGLE_API_KEY",
    settingKey: "googleApiKey",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultContextWindow: 1_048_576,
    vision: true,
    placeholder: "AIza...",
    docsUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    settingKey: "openrouterApiKey",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultContextWindow: 128_000,
    freeOnly: true,
    headers: () => ({ "HTTP-Referer": "http://localhost:3000", "X-Title": "DevChat" }),
    placeholder: "sk-or-...",
    docsUrl: "https://openrouter.ai/keys",
  },
  {
    id: "nvidia-nim",
    label: "NVIDIA NIM",
    envKey: "NVIDIA_NIM_API_KEY",
    envBaseUrl: "NVIDIA_NIM_BASE_URL",
    settingKey: "nvidiaNimApiKey",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    defaultContextWindow: 128_000,
    placeholder: "nvapi-...",
    docsUrl: "https://build.nvidia.com/",
  },
  {
    id: "custom",
    label: "Custom OpenAI-compatible",
    envKey: "CUSTOM_API_KEY",
    envBaseUrl: "CUSTOM_BASE_URL",
    settingKey: "customApiKey",
    baseUrlSettingKey: "customBaseUrl",
    keyOptional: true,
    defaultContextWindow: 32_768,
    placeholder: "optional for local servers",
  },
];

/** Env var names other tools use for providers we know. */
export const ENV_ALIASES: Record<string, string> = {
  GEMINI_API_KEY: "google",
  GOOGLE_GENERATIVE_AI_API_KEY: "google",
};

/** Model-id prefixes of CLI-backed providers (see cliProviders.ts); client-safe. */
export const CLI_PROVIDER_IDS = ["claude-code", "codex", "opencode"] as const;

export function isCliModelId(modelId: string): boolean {
  const prefix = modelId.slice(0, modelId.indexOf("/"));
  return (CLI_PROVIDER_IDS as readonly string[]).includes(prefix);
}

/** The provider that owns a model id, or undefined for Ollama/unknown ids. */
export function providerForModel(modelId: string): ProviderDef | undefined {
  const slash = modelId.indexOf("/");
  if (slash < 0) return undefined;
  const prefix = modelId.slice(0, slash);
  return PROVIDERS.find((p) => p.id === prefix);
}

/** Upstream model id with the DevChat provider prefix removed. */
export function bareModelId(modelId: string): string {
  return modelId.slice(modelId.indexOf("/") + 1);
}

const NON_CHAT_MODEL = /embedding|embed-|whisper|tts|audio|realtime|transcribe|moderation|dall-e|image|imagen|veo|aqa|babbage|davinci|search-preview|computer-use/i;

/**
 * Providers' /models endpoints list everything they sell (embeddings, speech,
 * image generation). Keep only what can hold a chat.
 */
export function isChatModel(providerId: string, upstreamId: string): boolean {
  if (NON_CHAT_MODEL.test(upstreamId)) return false;
  if (providerId === "openai") return /^(gpt-|o\d|chatgpt-)/.test(upstreamId);
  if (providerId === "google") return /gemini|gemma/i.test(upstreamId);
  return true;
}
