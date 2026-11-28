import { resolveProviderCreds } from "@/lib/apiKeys";
import { pickDefaultModel } from "@/lib/defaultModel";
import { canUseHostTools } from "@/lib/hostAccess";
import { listModels } from "@/lib/models";
import { mockModelCatalog } from "@/lib/mockModels";
import { providerOf } from "@/lib/providers";
import { getSettingsKey } from "@/lib/settings";

/** The model for a new chat that was not given one: see pickDefaultModel. A listing failure keeps the saved default. */
export async function resolveNewChatModel(userId: string) {
  const saved = await getSettingsKey(userId, "defaultModel");
  try {
    const { models, status } = await listModels(await resolveProviderCreds(userId), await canUseHostTools(userId));
    // A provider that errored lists no models, so the saved one would look gone: keep it, the send explains.
    if (saved && status.some((s) => s.id === providerOf(saved) && s.error)) return { id: saved, replaced: null };
    return pickDefaultModel(saved, [...mockModelCatalog(), ...models]);
  } catch (e) {
    console.error("Could not list models to pick a default:", e);
    return { id: saved || undefined, replaced: null };
  }
}
