import { wrapLanguageModel } from "ai";
import { friendlyProviderErrorMessage, isTransientProviderError } from "@/lib/chat/providerErrors";

export interface FallbackCandidate {
  id: string;
  model: any;
  providerOptions?: any;
  /** False strips tools/toolChoice from the call: the primary's tool set must not reach a model that can't use it. */
  supportsTools?: boolean;
}

export interface FallbackOptions {
  /** The id of the model being wrapped (for the auth message and the Ollama check). */
  primaryId: string;
  fallbacks: FallbackCandidate[];
  /** Ollama said the prompt overflows num_ctx: returns the larger window it switched to, or null when there is none. */
  onContextOverflow?: (modelId: string) => Promise<number | null>;
  /** Called with the id of the candidate whose stream is being returned, before the first chunk is read. */
  onServed?: (id: string) => void;
  retriesPerModel?: number;
  baseDelayMs?: number;
}

const errText = (e: unknown) =>
  `${e instanceof Error ? e.message : String(e)} ${(e as { statusCode?: number })?.statusCode ?? ""}`;

function withNumCtx(params: any, numCtx: number) {
  const ollama = params.providerOptions?.ollama ?? {};
  return { ...params, providerOptions: { ...params.providerOptions, ollama: { ...ollama, options: { ...ollama.options, num_ctx: numCtx } } } };
}

/**
 * Wraps `model` so a provider that fails before it emits anything (429/5xx/401 reject doStream) is retried
 * with a short backoff, then replaced by the next candidate. Once a chunk is out the stream is the caller's: no restart.
 * The primary's error is thrown when every candidate fails, so the auth message names the model the user picked.
 * Only doStream is wrapped: the chat route never calls doGenerate.
 */
export function withFallback(model: any, opts: FallbackOptions) {
  const retries = opts.retriesPerModel ?? 2;
  const baseDelay = opts.baseDelayMs ?? 400;
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v3",
      wrapStream: async ({ doStream, params }) => {
        let firstError: unknown;
        const chain = [
          { id: opts.primaryId, call: (p: any) => (p === params ? doStream() : model.doStream(p)), params },
          ...opts.fallbacks.map((c) => ({
            id: c.id,
            call: (p: any) => c.model.doStream(p),
            params: {
              ...params,
              providerOptions: c.providerOptions,
              ...(c.supportsTools === false ? { tools: undefined, toolChoice: undefined } : {}),
            },
          })),
        ];
        for (const [i, cand] of chain.entries()) {
          let p = cand.params;
          let bumped = false;
          for (let attempt = 0; attempt < retries; attempt++) {
            try {
              const res = await cand.call(p);
              opts.onServed?.(cand.id);
              return res;
            } catch (err) {
              firstError ??= err;
              if (params.abortSignal?.aborted) throw err;
              const msg = errText(err);
              const isOllama = cand.id.startsWith("ollama/");
              if (!bumped && isOllama && msg.includes("available context size")) {
                const next = await opts.onContextOverflow?.(cand.id);
                if (next) {
                  bumped = true;
                  p = withNumCtx(p, next);
                  attempt--;
                  continue;
                }
              }
              const auth = friendlyProviderErrorMessage(msg, { servedModel: cand.id, isOllama });
              if (!auth && !isTransientProviderError(msg)) throw err; // a 400 is the request's fault: another model won't fix it
              if (auth) break; // the same key fails again
              if (attempt < retries - 1) await new Promise((r) => setTimeout(r, baseDelay * 2 ** attempt));
            }
          }
          console.warn(`[chat] ${cand.id} failed before streaming${i < chain.length - 1 ? ", trying the next candidate" : ""}`);
        }
        throw firstError;
      },
    },
  });
}
