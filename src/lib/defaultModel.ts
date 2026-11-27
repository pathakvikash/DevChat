import { isBridgeModel } from "@/lib/bridge/client";
import { isBridgeLocalModel } from "@/lib/bridge/constants";

/** The built-in preference for a new chat: Claude Haiku 5.5, through Anthropic's own API, else through OpenRouter. */
export const PREFERRED_MODEL_ID = "anthropic/claude-haiku-5-5"; // `<provider id>/<Anthropic API id>`, as models.ts lists it
const PREFERRED_OPENROUTER_SUFFIX = "anthropic/claude-haiku-5.5"; // an OpenRouter id is `openrouter/<vendor>/<model>`

interface Listed {
  id: string;
  disabledReason?: string;
}

/**
 * The model a new chat starts with, never one that is not in `models`:
 * 1. the saved default, if it is listed (a bridge model is the browser's to list, so it is kept as is);
 * 2. Haiku 5.5 when a listed provider offers it (Anthropic first, then OpenRouter);
 * 3. the first listed model that is usable.
 * `replaced` is the saved default that could not be used, for the note shown to the user.
 */
export function pickDefaultModel(saved: string | null | undefined, models: Listed[]): { id: string | undefined; replaced: string | null } {
  const usable = models.filter((m) => !m.disabledReason);
  if (saved && (usable.some((m) => m.id === saved) || isBridgeModel(saved) || isBridgeLocalModel(saved))) return { id: saved, replaced: null };
  const haiku = usable.find((m) => m.id === PREFERRED_MODEL_ID) ?? usable.find((m) => m.id.startsWith("openrouter/") && m.id.endsWith(`/${PREFERRED_OPENROUTER_SUFFIX}`));
  const id = (haiku ?? usable[0])?.id;
  // Nothing is listed (no provider is set up): leave the saved value alone and let the send explain what is missing.
  if (!id) return { id: saved || undefined, replaced: null };
  return { id, replaced: saved || null };
}
