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

const isLocalOrFree = (id: string) => id.startsWith("ollama/") || id.startsWith("lmstudio/") || (id.startsWith("openrouter/") && id.endsWith(":free"));

/**
 * The model a chat starts with when it was not given one, never one that is not in `models`. One order for the
 * new-chat picker and for /api/chat:
 * 1. the saved default, if it is listed (a bridge model is the browser's to list, so it is kept as is);
 * 2. Haiku 5.5 through Anthropic's own API;
 * 3. a local or free listed model (Ollama, LM Studio, OpenRouter ":free"), one with tools first;
 * 4. Haiku 5.5 through OpenRouter;
 * 5. the first listed model that is usable.
 * `replaced` is the saved default that could not be used. `auto` means the model was picked here, not saved by the
 * user, so the chat should say which one it uses.
 */
export function pickDefaultModel(
  saved: string | null | undefined,
  models: Listed[],
): { id: string | undefined; name?: string; replaced: string | null; auto: boolean } {
  const usable = models.filter((m) => !m.disabledReason);
  if (saved && (usable.some((m) => m.id === saved) || isBridgeModel(saved) || isBridgeLocalModel(saved))) return { id: saved, replaced: null, auto: false };
  const local = usable.filter((m) => isLocalOrFree(m.id));
  const picked =
    usable.find((m) => m.id === PREFERRED_MODEL_ID) ??
    local.find((m) => m.supportsTools !== false) ??
    local[0] ??
    usable.find((m) => m.id.startsWith("openrouter/") && m.id.endsWith(`/${PREFERRED_OPENROUTER_SUFFIX}`)) ??
    usable[0];
  // Nothing is listed (no provider is set up): leave the saved value alone and let the send explain what is missing.
  if (!picked) return { id: saved || undefined, replaced: null, auto: false };
  return { id: picked.id, name: picked.name, replaced: saved || null, auto: true };
}
