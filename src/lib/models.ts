import { createHash } from "crypto";
import { createOpenAI } from "@ai-sdk/openai";
import { createOllama } from "ollama-ai-provider-v2";
import {
  PROVIDERS,
  providerForModel,
  bareModelId,
  isChatModel,
  type ProviderDef,
} from "./providers";
import { listCliModels, cliProviderForModel, createCliModel, type CliCatalogEntry } from "./cliProviders";
import { detectionAvailable } from "./providerDetect";
import { mockModelConfig } from "@/lib/mockModels";

const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const ollama = createOllama({ baseURL: `${ollamaUrl}/api` });

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  model: any;
  costPer1kInputTokens: number;
  costPer1kOutputTokens: number;
  maxTokens: number;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
}

export interface ModelCatalogEntry {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
}

export interface OllamaModelInfo {
  name: string;
  size: number;
  digest: string;
  details?: any;
  modifiedAt: string;
  contextWindow?: number;
}

// ─── Capability heuristics (shared by Ollama and hosted providers) ──────────

function getDefaultContextWindow(modelName: string): number {
  const name = modelName.toLowerCase();
  if (name.includes("llama3.2") || name.includes("llama3.1")) return 8192;
  if (name.includes("llama3")) return 8192;
  if (name.includes("qwen") || name.includes("ministral")) return 32768;
  if (name.includes("gemma")) return 8192;
  if (name.includes("phi3")) return 4096;
  if (name.includes("granite")) return 131072;
  return 8192;
}

export function getSupportsTools(modelName: string): boolean {
  const name = modelName.toLowerCase();
  if (
    name.includes("llama3.1") ||
    name.includes("llama3.2") ||
    name.includes("llama3.3")
  )
    return true;
  if (name.includes("llama3")) return true;
  if (name.includes("qwen2.5") || name.includes("qwen3")) return true;
  if (name.includes("qwen2")) return true;
  if (
    name.includes("mistral") ||
    name.includes("mixtral") ||
    name.includes("ministral")
  )
    return true;
  if (name.includes("command-r")) return true;
  if (name.includes("nemotron")) return true;
  if (name.includes("granite")) return true;
  if (name.includes("deepseek")) return true;
  if (name.includes("phi4") || name.includes("phi-4")) return true;
  return false;
}

export function getSupportsVision(modelName: string): boolean {
  const name = modelName.toLowerCase();
  if (name.includes("vision") || name.includes("llava") || name.includes("vl"))
    return true;
  if (name.includes("gemma3")) return true;
  if (name.includes("pixtral")) return true;
  if (name.includes("minicpm")) return true;
  if (name.includes("ministral")) return true;
  if (
    name.includes("qwen2.5-vl") ||
    name.includes("qwen3-vl") ||
    name.includes("qwen2-vl")
  )
    return true;
  if (
    name.includes("llama3.2-vision") ||
    name.includes("llama-3.2-11b-vision") ||
    name.includes("llama-3.2-90b-vision")
  )
    return true;
  return false;
}

export function getSupportsThinking(modelName: string): boolean {
  const name = modelName.toLowerCase();
  if (name.includes("deepseek-r1") || name.includes("deepseek-r1-"))
    return true;
  if (name.includes("qwq")) return true;
  if (name.includes("thinking")) return true;
  if (/^o\d/.test(name)) return true; // OpenAI o1/o3/o4 reasoning models
  return false;
}

// ─── Ollama (local, discovered via /api/tags) ───────────────────────────────

const ollamaModelCache: Record<string, ModelConfig> = {};
let ollamaModelInfoCache: OllamaModelInfo[] = [];
let ollamaModelsFetchedAt = 0;
const OLLAMA_CACHE_TTL = 30_000; // 30 seconds

function createOllamaModelConfig(modelInfo: OllamaModelInfo): ModelConfig {
  const modelName = modelInfo.name;
  const contextWindow =
    modelInfo.contextWindow ?? getDefaultContextWindow(modelName);
  return {
    id: `ollama/${modelName}`,
    name: modelName.replace(":latest", ""),
    provider: "Ollama",
    model: ollama(modelName),
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    maxTokens: 4096,
    contextWindow,
    supportsTools: getSupportsTools(modelName),
    supportsVision: getSupportsVision(modelName),
    supportsThinking: getSupportsThinking(modelName),
  };
}

async function fetchModelContext(
  modelName: string,
): Promise<number | undefined> {
  try {
    const cleanName = modelName.replace(":latest", "");
    const res = await fetch(`${ollamaUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: cleanName }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    if (!data) return undefined;

    // 1) Check model_info.context_length fields (most reliable — GGUF metadata)
    if (data.model_info) {
      for (const [key, val] of Object.entries(data.model_info)) {
        if (
          key.endsWith(".context_length") &&
          typeof val === "number" &&
          val > 0
        ) {
          console.log(
            `[ollama] ${cleanName} context_length=${val} (from model_info.${key})`,
          );
          return val;
        }
      }
    }

    // 2) Fallback: parse parameters / modelfile for context_length
    const haystack = [data.parameters || "", data.modelfile || ""].join("\n");
    const match = haystack.match(/context_length\s+(\d+)/);
    if (match) {
      const ctx = parseInt(match[1], 10);
      console.log(`[ollama] ${cleanName} context_length=${ctx}`);
      return ctx;
    }

    console.log(`[ollama] ${cleanName} context_length not found`);
    return undefined;
  } catch (e) {
    console.warn(`[ollama] failed to fetch show for ${modelName}:`, e);
    return undefined;
  }
}

export async function fetchOllamaModels(): Promise<OllamaModelInfo[]> {
  const now = Date.now();
  if (
    ollamaModelInfoCache.length > 0 &&
    now - ollamaModelsFetchedAt < OLLAMA_CACHE_TTL
  ) {
    return ollamaModelInfoCache;
  }

  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    const models: OllamaModelInfo[] = (data.models || []).map((m: any) => ({
      ...m,
      contextWindow: undefined,
    }));

    // Fetch actual context windows from /api/show in parallel
    const results = await Promise.allSettled(
      models.map((m) =>
        fetchModelContext(m.name).then((ctx) => ({ name: m.name, ctx })),
      ),
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.ctx) {
        const model = models.find((m) => m.name === r.value.name);
        if (model) model.contextWindow = r.value.ctx;
      }
    }

    ollamaModelInfoCache = models;
    ollamaModelsFetchedAt = Date.now();
    return ollamaModelInfoCache;
  } catch (error) {
    console.error("Failed to fetch Ollama models:", error);
    return ollamaModelInfoCache;
  }
}

export async function initializeOllamaModels(): Promise<void> {
  const models = await fetchOllamaModels();
  for (const modelInfo of models) {
    const modelId = `ollama/${modelInfo.name}`;
    ollamaModelCache[modelId] = createOllamaModelConfig(modelInfo);
  }
}

// ─── Hosted providers (OpenAI-compatible, bring-your-own-key) ───────────────

/** Resolved credentials per provider id. Built per request in apiKeys.ts. */
export type ProviderCreds = Record<string, { apiKey: string; baseUrl: string }>;

export interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  modelCount: number;
  error?: string;
  /** "cli" = an installed coding-agent CLI run locally, not a keyed API. */
  kind?: "cli";
}

function cliModelConfig(e: CliCatalogEntry): ModelConfig {
  return {
    id: e.id,
    name: e.name,
    provider: e.provider,
    model: e.model,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    maxTokens: 4096,
    contextWindow: e.contextWindow,
    // DevChat's tools reach the CLI through a prompt protocol (see
    // cliProviders.ts); the CLI's own file/shell tools stay disabled.
    supportsTools: true,
    supportsVision: false,
    // Thinking is surfaced where the CLI exposes it (OpenCode text, Claude
    // Code token count) and "reasoning effort" applies to all three.
    supportsThinking: true,
  };
}

/** Server-wide credentials from env vars, or undefined when not set. */
export function envCredsFor(def: ProviderDef): { apiKey: string; baseUrl: string } | undefined {
  const apiKey = process.env[def.envKey] || "";
  const baseUrl = (def.envBaseUrl && process.env[def.envBaseUrl]) || def.baseUrl || "";
  if (!baseUrl) return undefined;
  if (!apiKey && !def.keyOptional) return undefined;
  return { apiKey, baseUrl };
}

// Per-provider /models cache, keyed by a hash of (provider, base URL, key) so raw keys
// never sit in a Map and a chat turn doesn't re-download a ~1 MB catalog.
const catalogCache = new Map<string, { at: number; entries: ModelCatalogEntry[] }>();
const CATALOG_TTL = 5 * 60_000;

function cacheKey(def: ProviderDef, cred: { apiKey: string; baseUrl: string }): string {
  const digest = createHash("sha256").update(cred.apiKey).digest("hex").slice(0, 16);
  return `${def.id}|${cred.baseUrl}|${digest}`;
}

function requestHeaders(def: ProviderDef, apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, ...def.headers?.(apiKey) };
}

interface UpstreamModel {
  id?: string;
  name?: string;
  display_name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

function toCatalogEntry(def: ProviderDef, m: UpstreamModel): ModelCatalogEntry | null {
  if (!m.id) return null;
  // Gemini's compat endpoint returns "models/gemini-..." but accepts bare ids.
  const upstreamId = m.id.replace(/^models\//, "");
  if (!isChatModel(def.id, upstreamId)) return null;
  if (def.id === "openrouter" && !upstreamId.includes("/")) return null;
  if (def.freeOnly) {
    const p = m.pricing || {};
    if (parseFloat(p.prompt || "0") !== 0 || parseFloat(p.completion || "0") !== 0) return null;
  }
  const name = m.display_name || m.name || upstreamId;
  const haystack = `${upstreamId} ${name}`;
  return {
    id: `${def.id}/${upstreamId}`,
    name,
    provider: def.label,
    contextWindow: m.context_length || def.defaultContextWindow,
    // Hosted chat models nearly all support tool calling; only the explicit
    // completion-style ones don't.
    supportsTools: getSupportsTools(haystack) || !/instruct|chat-bison/i.test(haystack),
    supportsVision: def.vision || getSupportsVision(haystack),
    supportsThinking: getSupportsThinking(haystack),
  };
}

/** A failure whose message is safe to show the user: built here, never from the provider's response. */
class CatalogError extends Error {}

async function fetchCatalog(
  def: ProviderDef,
  cred: { apiKey: string; baseUrl: string },
): Promise<ModelCatalogEntry[]> {
  const key = cacheKey(def, cred);
  const hit = catalogCache.get(key);
  if (hit && Date.now() - hit.at < CATALOG_TTL) return hit.entries;

  const res = await fetch(`${cred.baseUrl.replace(/\/$/, "")}/models`, {
    headers: requestHeaders(def, cred.apiKey),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new CatalogError(`HTTP ${res.status}`);
  // A JSON parse error quotes the start of the body, so it must not reach the client as is.
  const data = await res.json().catch(() => {
    throw new CatalogError("Invalid response");
  });
  // OpenAI-style `{ data: [...] }`; a few servers return a bare array.
  const items: UpstreamModel[] = Array.isArray(data) ? data : data.data || [];
  const entries = items
    .map((m) => toCatalogEntry(def, m))
    .filter((e): e is ModelCatalogEntry => e !== null);
  catalogCache.set(key, { at: Date.now(), entries });
  return entries;
}

function cachedEntry(def: ProviderDef, cred: { apiKey: string; baseUrl: string }, modelId: string) {
  return catalogCache.get(cacheKey(def, cred))?.entries.find((e) => e.id === modelId);
}

function providerClient(def: ProviderDef, cred: { apiKey: string; baseUrl: string }) {
  return createOpenAI({
    baseURL: cred.baseUrl,
    apiKey: cred.apiKey,
    name: def.id,
    headers: def.headers?.(cred.apiKey),
  });
}

function toModelConfig(
  def: ProviderDef,
  entry: ModelCatalogEntry,
  client: ReturnType<typeof createOpenAI>,
): ModelConfig {
  return {
    ...entry,
    model: client.chat(bareModelId(entry.id)),
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    maxTokens: 4096,
    supportsTools: entry.supportsTools ?? true,
  };
}

/** Every model these creds can reach. Provider failures land in `status` rather than
 *  throwing, so one broken key doesn't hide the rest. CLI models run on the server's machine,
 *  so they are listed only when `hostTools` says this user may use them (canUseHostTools). */
export async function listModels(
  creds: ProviderCreds,
  hostTools = false,
): Promise<{ models: ModelConfig[]; status: ProviderStatus[] }> {
  await initializeOllamaModels();
  const models: ModelConfig[] = Object.values(ollamaModelCache);

  // Coding-agent CLIs installed on this machine (local server only).
  const cliStatus: ProviderStatus[] = [];
  if (hostTools && detectionAvailable()) {
    const cli = await listCliModels();
    for (const e of cli.entries) models.push(cliModelConfig(e));
    cliStatus.push(...cli.status);
  }

  const status = await Promise.all(
    PROVIDERS.map(async (def): Promise<ProviderStatus> => {
      const cred = creds[def.id];
      if (!cred) return { id: def.id, label: def.label, configured: false, modelCount: 0 };
      try {
        const entries = await fetchCatalog(def, cred);
        const client = providerClient(def, cred);
        for (const e of entries) models.push(toModelConfig(def, e, client));
        return { id: def.id, label: def.label, configured: true, modelCount: entries.length };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[models] ${def.label} unavailable: ${message}`);
        const shown = error instanceof CatalogError ? message : "Could not reach this provider";
        return { id: def.id, label: def.label, configured: true, modelCount: 0, error: shown };
      }
    }),
  );

  return { models, status: [...status, ...cliStatus] };
}

/** Runnable config for one model id. Hosted models are built fresh from `creds` so
 *  concurrent users never share a client or a key. Throws on unknown id or no creds.
 *  A CLI model needs `hostTools` (canUseHostTools): it runs as the server's OS user. */
export function getModel(modelId: string, creds: ProviderCreds = {}, hostTools = false): ModelConfig {
  const mock = mockModelConfig(modelId);
  if (mock) return mock;
  if (ollamaModelCache[modelId]) return ollamaModelCache[modelId];

  if (modelId.startsWith("ollama/")) {
    const modelName = modelId.replace("ollama/", "");
    const modelInfo = ollamaModelInfoCache.find((m) => {
      const baseName = m.name.split(":")[0];
      return baseName === modelName || m.name === modelName;
    });
    if (modelInfo) {
      const config = createOllamaModelConfig(modelInfo);
      ollamaModelCache[modelId] = config;
      return config;
    }
    throw new Error(`Model ${modelId} not found in Ollama`);
  }

  const cliDef = cliProviderForModel(modelId);
  if (cliDef) {
    if (!detectionAvailable()) {
      throw new Error(`${cliDef.label} is only available when DevChat runs on your own machine`);
    }
    if (!hostTools) throw new Error(`${cliDef.label} is only available to the server's owner`);
    const upstreamId = bareModelId(modelId);
    return cliModelConfig({
      id: modelId,
      name: upstreamId,
      provider: cliDef.label,
      contextWindow: cliDef.contextWindow,
      model: createCliModel(cliDef, upstreamId),
    });
  }

  const def = providerForModel(modelId);
  if (!def) throw new Error(`Model ${modelId} not found`);
  const cred = creds[def.id] ?? envCredsFor(def);
  if (!cred) throw new Error(`${def.label} is not configured`);

  const upstreamId = bareModelId(modelId);
  const entry: ModelCatalogEntry = cachedEntry(def, cred, modelId) ?? {
    id: modelId,
    name: upstreamId,
    provider: def.label,
    contextWindow: def.defaultContextWindow,
    supportsTools: true,
    supportsVision: def.vision || getSupportsVision(upstreamId),
    supportsThinking: getSupportsThinking(upstreamId),
  };
  return toModelConfig(def, entry, providerClient(def, cred));
}
