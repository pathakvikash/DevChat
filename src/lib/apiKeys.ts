import { PROVIDERS } from "./providers";
import { envCredsFor, type ProviderCreds } from "./models";
import { getSettingsKeys } from "./settings";

/** Hosted-provider creds for this user. A key saved in Settings wins over the server
 *  env var, so shared deployments stay per-user while self-hosters set env once.
 *  A base URL the user saved is theirs alone: the server's env key never goes to it. */
export async function resolveProviderCreds(userId: string): Promise<ProviderCreds> {
  const wanted = PROVIDERS.flatMap((p) =>
    p.baseUrlSettingKey ? [p.settingKey, p.baseUrlSettingKey] : [p.settingKey],
  );
  const saved = await getSettingsKeys(userId, wanted);

  const creds: ProviderCreds = {};
  for (const p of PROVIDERS) {
    const env = envCredsFor(p);
    const userBaseUrl = (p.baseUrlSettingKey && saved[p.baseUrlSettingKey]) || "";
    const apiKey = saved[p.settingKey] || (userBaseUrl ? "" : env?.apiKey) || "";
    const baseUrl = userBaseUrl || env?.baseUrl || p.baseUrl || "";
    if (!baseUrl) continue;
    if (!apiKey && !p.keyOptional) continue;
    creds[p.id] = { apiKey, baseUrl };
  }
  return creds;
}
