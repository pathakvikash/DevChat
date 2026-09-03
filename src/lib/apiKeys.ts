import { PROVIDERS } from "./providers";
import { envCredsFor, type ProviderCreds } from "./models";
import { getSettingsKeys } from "./settings";

/**
 * Which hosted providers this user can talk to, and with what. A key saved in
 * Settings wins over the server's env var, so on a shared deployment each user
 * brings their own key while a self-hoster can just set env vars once.
 */
export async function resolveProviderCreds(userId: string): Promise<ProviderCreds> {
  const wanted = PROVIDERS.flatMap((p) =>
    p.baseUrlSettingKey ? [p.settingKey, p.baseUrlSettingKey] : [p.settingKey],
  );
  const saved = await getSettingsKeys(userId, wanted);

  const creds: ProviderCreds = {};
  for (const p of PROVIDERS) {
    const env = envCredsFor(p);
    const apiKey = saved[p.settingKey] || env?.apiKey || "";
    const baseUrl =
      (p.baseUrlSettingKey && saved[p.baseUrlSettingKey]) || env?.baseUrl || p.baseUrl || "";
    if (!baseUrl) continue;
    if (!apiKey && !p.keyOptional) continue;
    creds[p.id] = { apiKey, baseUrl };
  }
  return creds;
}
