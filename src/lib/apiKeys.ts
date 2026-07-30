import { getSettingsKey } from "./settings";

const ENV_KEY_MAP: Record<string, string | undefined> = {
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  nvidiaNimApiKey: process.env.NVIDIA_NIM_API_KEY,
};

async function resolveApiKey(
  keyName: "openrouterApiKey" | "nvidiaNimApiKey",
  requestSource?: string,
): Promise<string | undefined> {
  if (requestSource) return requestSource;
  const dbKey = await getSettingsKey(keyName);
  if (dbKey) return dbKey;
  return ENV_KEY_MAP[keyName] || undefined;
}

export async function resolveOpenRouterKey(bodyKey?: string) {
  return resolveApiKey("openrouterApiKey", bodyKey);
}

export async function resolveNvidiaNimKey(bodyKey?: string) {
  return resolveApiKey("nvidiaNimApiKey", bodyKey);
}
