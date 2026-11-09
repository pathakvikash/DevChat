import { cliProviderForModel } from "@/lib/cliProviders";
import type { MODE_POLICY } from "@/lib/chat/modes";

export interface ProviderOptionsInput {
  modelId: string;
  /** Ollama's `num_ctx`: the chat's context length, else the model's window. */
  numCtx: number;
  temperature?: number;
  topP?: number | null;
  maxTokens?: number | null;
  reasoningEffort?: string | null;
  /** CLI models: a runnable folder, or "" for the sandboxed scratch folder. */
  cwd: string;
  access: (typeof MODE_POLICY)[keyof typeof MODE_POLICY]["cli"];
  conversationId: string;
  userId: string;
  allowedTools: string[];
}

/**
 * The provider options a model gets: Ollama's sampling window, or a CLI model's effort, folder and access.
 * Shared by the chat route and workflow agent cards. Hosted models get none.
 */
export function providerOptionsFor(i: ProviderOptionsInput) {
  if (i.modelId.startsWith("ollama/")) {
    return {
      ollama: {
        num_ctx: i.numCtx,
        temperature: i.temperature,
        top_p: i.topP ?? 0.9,
        num_predict: i.maxTokens || -1,
      },
    };
  }
  const cli = cliProviderForModel(i.modelId);
  if (!cli) return undefined;
  return {
    [cli.id]: {
      effort: i.reasoningEffort ?? "",
      cwd: i.cwd,
      access: i.access,
      conversationId: i.conversationId,
      userId: i.userId,
      allowedTools: i.allowedTools,
    },
  };
}
