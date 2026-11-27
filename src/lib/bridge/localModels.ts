// The bridge daemon's local models: Ollama and LM Studio on this computer, listed and run text-only. Node side (the daemon).
import type { LanguageModel } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import { PROVIDERS, isChatModel } from "@/lib/providers";
import { getDefaultContextWindow, getSupportsThinking, getSupportsVision, ollamaLanguageModel, providerClient } from "@/lib/models";

export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
export const DEFAULT_LMSTUDIO_URL = "http://127.0.0.1:1234/v1";
const LIST_TIMEOUT_MS = 1500;
const CACHE_MS = 5000;
const MAX_MODELS = 200;

export type LocalUrls = { ollamaUrl: string; lmstudioUrl: string };
export type LocalModelInfo = { id: string; name: string; provider: string; contextWindow: number; supportsTools: false; supportsVision?: boolean; supportsThinking?: boolean };

/**
 * The only hosts a local-model URL may name. The bridge fetches these URLs on the page's behalf, so anything else
 * would turn it into a proxy to other machines. (The page never supplies a URL: they come from the bridge's config.)
 */
export function isLoopbackUrl(raw: string): boolean {
  if (!URL.canParse(raw)) return false;
  const u = new URL(raw);
  return (u.protocol === "http:" || u.protocol === "https:") && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) && !u.username && !u.password;
}

/** A loopback URL without a trailing slash, or throws. */
export function loopbackUrlOrThrow(flag: string, raw: string): string {
  if (!isLoopbackUrl(raw)) throw new Error(`${flag} must be an http(s) URL on 127.0.0.1, localhost or [::1]: the bridge only talks to this computer.`);
  return raw.replace(/\/+$/, "");
}

async function getJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  // redirect: "error": a loopback server must not bounce the bridge to another host.
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS), redirect: "error" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const asArray = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
const MODEL_ID = /^[\x20-\x7e]{1,200}$/;

async function listOllama(url: string, fetchImpl: typeof fetch): Promise<LocalModelInfo[]> {
  const data = (await getJson(fetchImpl, `${url}/api/tags`)) as { models?: unknown };
  return asArray(data?.models)
    .map((m) => String(m.name ?? ""))
    .filter((n) => MODEL_ID.test(n))
    .slice(0, MAX_MODELS)
    .map((n) => ({
      id: `ollama/${n}`,
      name: n.replace(":latest", ""),
      provider: "Ollama",
      contextWindow: getDefaultContextWindow(n),
      supportsTools: false as const,
      supportsVision: getSupportsVision(n),
      supportsThinking: getSupportsThinking(n),
    }));
}

async function listLmStudio(url: string, fetchImpl: typeof fetch): Promise<LocalModelInfo[]> {
  const data = (await getJson(fetchImpl, `${url}/models`)) as { data?: unknown } | unknown[];
  return asArray(Array.isArray(data) ? data : data?.data)
    .map((m) => String(m.id ?? ""))
    .filter((id) => MODEL_ID.test(id) && isChatModel("lmstudio", id))
    .slice(0, MAX_MODELS)
    .map((id) => ({
      id: `lmstudio/${id}`,
      name: id,
      provider: "LM Studio",
      contextWindow: 32_768, // same default as the server's provider entry
      supportsTools: false as const,
      supportsVision: getSupportsVision(id),
      supportsThinking: getSupportsThinking(id),
    }));
}

/** Both lists, each failing to an empty one (nothing running is normal, never an error). Callers cache; see `createLocalModels`. */
export async function listLocalModels(urls: LocalUrls, fetchImpl: typeof fetch = fetch): Promise<LocalModelInfo[]> {
  const [o, l] = await Promise.all([
    isLoopbackUrl(urls.ollamaUrl) ? listOllama(urls.ollamaUrl, fetchImpl).catch(() => []) : [],
    isLoopbackUrl(urls.lmstudioUrl) ? listLmStudio(urls.lmstudioUrl, fetchImpl).catch(() => []) : [],
  ]);
  return [...o, ...l];
}

/**
 * Builds the model the way the server does: Ollama through `ollamaLanguageModel` (models.ts, the same wrapper as
 * createOllamaModelConfig), LM Studio through `providerClient` (models.ts, the same client with reasoning_content handling).
 */
export function buildLocalModel(info: LocalModelInfo, urls: LocalUrls): LanguageModel {
  const bare = info.id.slice(info.id.indexOf("/") + 1);
  if (info.id.startsWith("ollama/")) return ollamaLanguageModel(createOllama({ baseURL: `${urls.ollamaUrl}/api` }), bare, info.contextWindow);
  const def = PROVIDERS.find((p) => p.id === "lmstudio")!;
  return providerClient(def, { apiKey: def.fallbackKey ?? "", baseUrl: urls.lmstudioUrl })(bare);
}

/** A few-seconds cache of the list, and the lookup /chat uses: a model id the daemon did not just list is unknown. */
export function createLocalModels(getUrls: () => LocalUrls, opts: { fetch?: typeof fetch; build?: (info: LocalModelInfo, urls: LocalUrls) => LanguageModel } = {}) {
  let cache: { at: number; key: string; models: LocalModelInfo[] } | null = null;
  const list = async (): Promise<LocalModelInfo[]> => {
    const urls = getUrls();
    const key = `${urls.ollamaUrl}|${urls.lmstudioUrl}`;
    if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.models;
    const models = await listLocalModels(urls, opts.fetch);
    cache = { at: Date.now(), key, models };
    return models;
  };
  return {
    list,
    async resolve(id: string): Promise<{ info: LocalModelInfo; model: LanguageModel } | null> {
      const info = (await list()).find((m) => m.id === id);
      if (!info) return null;
      const urls = getUrls();
      return { info, model: (opts.build ?? buildLocalModel)(info, urls) };
    },
  };
}
