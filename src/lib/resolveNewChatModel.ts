import { resolveProviderCreds } from "@/lib/apiKeys";
import { pickDefaultModel } from "@/lib/defaultModel";
import { canUseHostTools } from "@/lib/hostAccess";
import { listModels } from "@/lib/models";
import { mockModelCatalog } from "@/lib/mockModels";
import { getSettingsKey } from "@/lib/settings";

/** The model for a new chat that was not given one: see pickDefaultModel. A listing failure keeps the saved default. */
export async function resolveNewChatModel(userId: string) {
  const saved = await getSettingsKey(userId, "defaultModel");
  try {
    const { models } = await listModels(await resolveProviderCreds(userId), await canUseHostTools(userId));
    return pickDefaultModel(saved, [...mockModelCatalog(), ...models]);
  } catch (e) {
    console.error("Could not list models to pick a default:", e);
    return { id: saved || undefined, replaced: null };
  }
}
