// Maps the conversation's reasoning-effort setting onto each provider's request options.
// Pure and client-safe; only sends what the model id is known to accept.

import type { streamText } from "ai";
import { providerForModel, bareModelId } from "./providers";

export type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]["providerOptions"]>;

export interface ReasoningPlan {
  providerOptions?: ProviderOptions;
  /** False when the model rejects temperature/top_p, so the caller must leave them out. */
  allowSampling: boolean;
}

const LEVELS = ["low", "medium", "high", "max"];

/** "major.minor" as a comparable number, e.g. 5.6 -> 506. */
function version(major: string, minor?: string): number {
  return Number(major) * 100 + Number(minor ?? 0);
}

// o-series and GPT-5+ reason; "chat" snapshots and o1-mini/preview do not take effort.
function openaiReasons(id: string): boolean {
  if (/chat|^o1-(mini|preview)/.test(id)) return false;
  if (/^o[1-9](-|$)/.test(id)) return true;
  const m = /^gpt-(\d+)(?:\.(\d+))?/.exec(id);
  return !!m && version(m[1], m[2]) >= 500;
}

function openaiPlan(id: string, effort?: string): ReasoningPlan {
  if (!openaiReasons(id)) return { allowSampling: true };
  const m = /^gpt-(\d+)(?:\.(\d+))?/.exec(id);
  // "max" arrived with GPT-5.6, and -pro models only run at "high".
  const maxOk = !!m && version(m[1], m[2]) >= 506;
  const level = /-pro(-|$)/.test(id) ? "high" : effort === "max" && !maxOk ? "high" : effort;
  return {
    allowSampling: true,
    providerOptions: {
      openai: { reasoningSummary: "detailed", ...(level && LEVELS.includes(level) && { reasoningEffort: level }) },
    },
  };
}

// Adaptive thinking (no budget_tokens) exists on Opus/Sonnet 4.6+, Haiku 5+ and every Fable.
function anthropicAdaptive(id: string): boolean {
  const m = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(id);
  if (!m) return false;
  const v = version(m[2], m[3]);
  return m[1] === "fable" || (m[1] === "haiku" ? v >= 500 : v >= 406);
}

function anthropicPlan(id: string, effort?: string): ReasoningPlan {
  if (!anthropicAdaptive(id)) return { allowSampling: true };
  return {
    allowSampling: true,
    providerOptions: {
      anthropic: {
        thinking: { type: "adaptive", display: "summarized" },
        ...(effort && LEVELS.includes(effort) && { effort }),
      },
    },
  };
}

function geminiVersion(id: string): number {
  const m = /^gemini-(\d+)(?:\.(\d+))?/.exec(id);
  return m ? version(m[1], m[2]) : 0;
}

// Only Gemini 2.5+ thinks; 3.6+ also rejects temperature/top_p/top_k.
function googleThinks(id: string): boolean {
  return geminiVersion(id) >= 205;
}

function googlePlan(id: string, effort?: string): ReasoningPlan {
  const allowSampling = geminiVersion(id) < 306;
  if (!googleThinks(id) || !effort || !LEVELS.includes(effort)) return { allowSampling };
  // The compat endpoint reads `reasoning_effort` and has no "max".
  const reasoningEffort = effort === "max" ? "high" : effort;
  return { allowSampling, providerOptions: { openai: { reasoningEffort } } };
}

/** Request options for a hosted model id; ids from other providers get the defaults. */
export function reasoningPlan(modelId: string, effort?: string | null): ReasoningPlan {
  const def = providerForModel(modelId);
  const id = bareModelId(modelId);
  const level = effort || undefined;
  if (def?.id === "openai") return openaiPlan(id, level);
  if (def?.id === "anthropic") return anthropicPlan(id, level);
  if (def?.id === "google") return googlePlan(id, level);
  return { allowSampling: true };
}

/** Whether the effort setting does anything for this model (shows the control in the UI). */
export function supportsReasoning(modelId: string): boolean {
  const def = providerForModel(modelId);
  if (def?.id === "google") return googleThinks(bareModelId(modelId));
  return !!reasoningPlan(modelId).providerOptions;
}

/** `{ temperature }` for a hosted call, or nothing when the model rejects sampling params (Gemini 3.6+). */
export function temperatureFor(modelId: string, temperature: number): { temperature?: number } {
  return reasoningPlan(modelId).allowSampling ? { temperature } : {};
}
