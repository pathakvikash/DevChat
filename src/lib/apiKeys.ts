import { getSettingsKey } from "./settings";

const ENV_KEY_MAP: Record<string, string | undefined> = {
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  nvidiaNimApiKey: process.env.NVIDIA_NIM_API_KEY,
};

async function resolveApiKey(
  keyName: "openrouterApiKey" | "nvidiaNimApiKey",
  userId: string,
  requestSource?: string,
): Promise<string | undefined> {
  if (requestSource) return requestSource;
  const dbKey = await getSettingsKey(userId, keyName);
  if (dbKey) return dbKey;
  return ENV_KEY_MAP[keyName] || undefined;
}

export async function resolveOpenRouterKey(userId: string, bodyKey?: string) {
  return resolveApiKey("openrouterApiKey", userId, bodyKey);
}

export async function resolveNvidiaNimKey(userId: string, bodyKey?: string) {
  return resolveApiKey("nvidiaNimApiKey", userId, bodyKey);
}
