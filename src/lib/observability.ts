import { prisma } from "@/lib/db";

/**
 * Lightweight, dependency-free observability for chat completions.
 * One Trace row per assistant turn (possibly spanning many tool-call steps),
 * plus TraceToolCall rows for per-tool latency/cost drill-down.
 *
 * Cost is a best-effort estimate from a small price table (USD per 1K tokens).
 * Local models (ollama/*) cost $0. Unknown models return null (not guessed).
 */

// USD per 1K tokens: [input, output]. Extend as needed.
const PRICING: Record<string, [number, number]> = {
  // OpenAI
  "gpt-4o": [0.005, 0.015],
  "gpt-4o-mini": [0.00015, 0.0006],
  "gpt-4-turbo": [0.01, 0.03],
  "gpt-3.5-turbo": [0.0005, 0.0015],
  "o1": [0.015, 0.06],
  "o1-mini": [0.003, 0.012],
  "o3-mini": [0.0011, 0.0044],
  // Anthropic (via OpenRouter or direct)
  "claude-3.5-sonnet": [0.003, 0.015],
  "claude-3.5-haiku": [0.0008, 0.004],
  "claude-3-opus": [0.015, 0.075],
  "claude-3-sonnet": [0.003, 0.015],
  "claude-3-haiku": [0.00025, 0.00125],
  "claude-opus-4": [0.015, 0.075],
  "claude-sonnet-4": [0.003, 0.015],
  // Google
  "gemini-1.5-pro": [0.00125, 0.005],
  "gemini-1.5-flash": [0.000075, 0.0003],
  "gemini-2.0-flash": [0.0001, 0.0004],
  "gemini-2.5-pro": [0.00125, 0.01],
};

export type TraceStatus = "success" | "error" | "aborted" | "truncated";

export interface ToolCallObservation {
  toolName: string;
  input?: unknown;
  output?: unknown;
  ok?: boolean;
  latencyMs?: number;
}

export interface TraceObservation {
  conversationId?: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  firstTokenMs?: number | null;
  steps?: number;
  finishReason?: string | null;
  status: TraceStatus;
  errorMsg?: string | null;
  inputChars?: number;
  outputChars?: number;
  toolCalls?: ToolCallObservation[];
}

function deriveProvider(model: string): string | null {
  if (model.includes("/")) return model.split("/")[0];
  return null;
}

/** Strip a provider prefix to improve price-table lookup hits. */
function bareModel(model: string): string {
  return model.includes("/") ? model.split("/").pop()! : model;
}

function estimateCost(model: string, inTok: number, outTok: number): number | null {
  if (model.startsWith("ollama/")) return 0;
  const key = bareModel(model);
  const price = PRICING[model] ?? PRICING[key];
  if (!price) return null;
  return (inTok / 1000) * price[0] + (outTok / 1000) * price[1];
}

function truncate(value: unknown, max = 2000): unknown {
  if (value == null) return value;
  if (typeof value === "string") return value.length > max ? value.slice(0, max) + "…" : value;
  const str = JSON.stringify(value);
  if (!str) return str;
  return str.length > max ? str.slice(0, max) + "…" : str;
}

export async function recordTrace(obs: TraceObservation): Promise<void> {
  try {
    const totalTokens = obs.promptTokens + obs.completionTokens;
    const cost = estimateCost(obs.model, obs.promptTokens, obs.completionTokens);
    const trace = await prisma.trace.create({
      data: {
        conversationId: obs.conversationId ?? null,
        model: obs.model,
        provider: deriveProvider(obs.model),
        promptTokens: obs.promptTokens,
        completionTokens: obs.completionTokens,
        totalTokens,
        cost,
        latencyMs: obs.latencyMs,
        firstTokenMs: obs.firstTokenMs ?? null,
        steps: obs.steps ?? null,
        finishReason: obs.finishReason ?? null,
        status: obs.status,
        errorMsg: obs.errorMsg ?? null,
        inputChars: obs.inputChars ?? null,
        outputChars: obs.outputChars ?? null,
      },
    });

    if (obs.toolCalls && obs.toolCalls.length > 0) {
      await prisma.traceToolCall.createMany({
        data: obs.toolCalls.map((tc) => ({
          traceId: trace.id,
          toolName: tc.toolName,
          input: tc.input != null ? JSON.stringify(truncate(tc.input)) : null,
          output: tc.output != null ? JSON.stringify(truncate(tc.output)) : null,
          ok: tc.ok ?? true,
          latencyMs: tc.latencyMs ?? null,
        })),
      });
    }
  } catch (e) {
    console.error("[observability] failed to record trace:", e);
  }
}
