const STORAGE_PREFIX = "vas:settings";

export function getClientApiKeys() {
  if (typeof window === "undefined") return {};
  return {
    openrouterApiKey:
      localStorage.getItem(`${STORAGE_PREFIX}:openrouter_api_key`) || undefined,
    nvidiaNimApiKey:
      localStorage.getItem(`${STORAGE_PREFIX}:nvidia_nim_api_key`) || undefined,
  };
}

export function resolveOpenRouterKey(bodyKey?: string) {
  return bodyKey || process.env.OPENROUTER_API_KEY || undefined;
}

export function resolveNvidiaNimKey(bodyKey?: string) {
  return bodyKey || process.env.NVIDIA_NIM_API_KEY || undefined;
}
