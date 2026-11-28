import { isBridgeModel } from "@/lib/bridge/client";
import { isBridgeLocalModel } from "@/lib/bridge/constants";

/** The built-in preference for a new chat: Claude Haiku 5.5, through Anthropic's own API, else through OpenRouter. */
export const PREFERRED_MODEL_ID = "anthropic/claude-haiku-5-5"; // `<provider id>/<Anthropic API id>`, as models.ts lists it
const PREFERRED_OPENROUTER_SUFFIX = "anthropic/claude-haiku-5.5"; // an OpenRouter id is `openrouter/<vendor>/<model>`

interface Listed {
  id: string;
  name?: string;
  supportsTools?: boolean;
  disabledReason?: string;
}

const isLocal = (id: string) => id.startsWith("ollama/") || id.startsWith("lmstudio/");
const isFree = (id: string) => id.startsWith("openrouter/") && id.endsWith(":free");

/**
 * The listed models in the order a chat with no model should try them, never one that is not in `models`. One order
 * for the new-chat picker and for /api/chat:
 * 1. the saved default, if it is listed (in the browser's picker a bridge model is also kept, as the browser lists it);
 * 2. Haiku 5.5 through Anthropic's own API;
 * 3. a local model the list has (Ollama, LM Studio), one with tools first;
 * 4. Haiku 5.5 through OpenRouter;
 * 5. a free model known to support tools;
 * 6. any other usable listed model (left out with `namedOnly`, for fallbacks that must not pick an unknown, maybe costly, model).
 */
export function rankDefaultModels(saved: string | null | undefined, models: Listed[], keepBridge = true, namedOnly = false): Listed[] {
  const usable = models.filter((m) => !m.disabledReason);
  const local = usable.filter((m) => isLocal(m.id));
  const ranked = [
    ...usable.filter((m) => m.id === saved),
    ...usable.filter((m) => m.id === PREFERRED_MODEL_ID),
    ...local.filter((m) => m.supportsTools !== false),
    ...local,
    ...usable.filter((m) => m.id.startsWith("openrouter/") && m.id.endsWith(`/${PREFERRED_OPENROUTER_SUFFIX}`)),
    ...usable.filter((m) => isFree(m.id) && m.supportsTools === true),
    ...(namedOnly ? [] : usable),
  ];
  const out = ranked.filter((m, i) => ranked.findIndex((x) => x.id === m.id) === i);
  if (keepBridge && saved && !out.some((m) => m.id === saved) && (isBridgeModel(saved) || isBridgeLocalModel(saved))) out.unshift({ id: saved });
  return out;
}

/**
 * The model a chat starts with when it was not given one: the first of rankDefaultModels.
 * `replaced` is the saved default that could not be used. `auto` means the model was picked here, not saved by the
 * user, so the chat should say which one it uses.
 */
export function pickDefaultModel(
  saved: string | null | undefined,
  models: Listed[],
  keepBridge = true,
): { id: string | undefined; name?: string; replaced: string | null; auto: boolean } {
  const picked = rankDefaultModels(saved, models, keepBridge)[0];
  if (picked && picked.id === saved) return { id: saved, replaced: null, auto: false };
  // Nothing is listed (no provider is set up): leave the saved value alone and let the send explain what is missing.
  if (!picked) return { id: saved || undefined, replaced: null, auto: false };
  return { id: picked.id, name: picked.name, replaced: saved || null, auto: true };
}
