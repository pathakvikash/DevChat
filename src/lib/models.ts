import { createOpenAI } from "@ai-sdk/openai";
import { createOllama } from "ollama-ai-provider-v2";

const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const ollama = createOllama({ baseURL: `${ollamaUrl}/api` });

// ----- OpenAI-Compatible External Providers -----
interface ExternalProviderDef {
  envKey: string;
  envBaseUrl?: string;
  defaultBaseUrl: string;
  name: string;
  providerLabel: string;
  modelPrefix: string;
  extraHeaders?: Record<string, string>;
}

function createExternalProvider(def: ExternalProviderDef) {
  const envKey = process.env[def.envKey] || "";
  const baseUrl = process.env[def.envBaseUrl || ""] || def.defaultBaseUrl;
  let overrideKey: string | undefined;
  let provider: ReturnType<typeof createOpenAI> | null = null;
  const modelCache: Record<string, ModelConfig> = {};
  let modelCatalog: ModelCatalogEntry[] = [];

  function getEffectiveKey() {
    return overrideKey || envKey;
  }

  function setKey(key?: string) {
    overrideKey = key || undefined;
    provider = null;
  }

  function getProvider() {
    const key = getEffectiveKey();
    if (!provider) {
      if (!key) {
        throw new Error(`${def.envKey} is not set`);
      }
      provider = createOpenAI({
        baseURL: baseUrl,
        apiKey: key,
        name: def.name,
        fetch: async (url, init) => {
          const headers = new Headers(init?.headers);
          if (def.extraHeaders) {
            for (const [k, v] of Object.entries(def.extraHeaders)) {
              headers.set(k, v);
            }
          }
          return fetch(url, { ...init, headers });
        },
      });
    }
    return provider;
  }

  function supportsToolsFromName(id: string, name: string): boolean {
    // For external API providers (OpenRouter, NVIDIA NIM), virtually all
    // models support tool calling. Assume true unless the name explicitly
    // indicates no-tool models like "instruct" or "chat-bison".
    const full = `${id} ${name}`.toLowerCase();
    if (full.includes("instruct") || full.includes("chat-bison")) return false;
    return true;
  }

  function addModel(
    id: string,
    name: string,
    contextWindow: number,
    pricing?: { prompt: string; completion: string },
  ) {
    const modelId = `${def.modelPrefix}/${id}`;
    if (!modelCache[modelId]) {
      const supportsTools =
        getSupportsTools(id) ||
        getSupportsTools(name) ||
        getSupportsTools(`${id} ${name}`) ||
        supportsToolsFromName(id, name);
      const supportsVision = getSupportsVision(id) || getSupportsVision(name);
      const supportsThinking =
        getSupportsThinking(id) || getSupportsThinking(name);
      modelCache[modelId] = {
        id: modelId,
        name,
        provider: def.providerLabel,
        model: getProvider().chat(id),
        costPer1kInputTokens: pricing ? parseFloat(pricing.prompt) || 0 : 0,
        costPer1kOutputTokens: pricing
          ? parseFloat(pricing.completion) || 0
          : 0,
        maxTokens: 4096,
        contextWindow,
        supportsTools,
        supportsVision,
        supportsThinking,
      };
      modelCatalog.push({
        id: modelId,
        name,
        provider: def.providerLabel,
        contextWindow,
        supportsTools,
        supportsVision,
        supportsThinking,
      });
    }
  }

  function addToCatalog(id: string, name: string, contextWindow: number) {
    const supportsTools =
      getSupportsTools(id) ||
      getSupportsTools(name) ||
      getSupportsTools(`${id} ${name}`) ||
      supportsToolsFromName(id, name);
    const supportsVision = getSupportsVision(id) || getSupportsVision(name);
    const supportsThinking =
      getSupportsThinking(id) || getSupportsThinking(name);
    modelCatalog.push({
      id: `${def.modelPrefix}/${id}`,
      name,
      provider: def.providerLabel,
      contextWindow,
      supportsTools,
      supportsVision,
      supportsThinking,
    });
  }

  return {
    get isAvailable() {
      return !!getEffectiveKey();
    },
    get envKey() {
      return def.envKey;
    },
    get modelPrefix() {
      return def.modelPrefix;
    },
    get modelCache() {
      return modelCache;
    },
    get modelCatalog() {
      return modelCatalog;
    },
    getProvider,
    setKey,
    addModel,
    addToCatalog,
  };
}

const openRouter = createExternalProvider({
  envKey: "OPENROUTER_API_KEY",
  defaultBaseUrl: "https://openrouter.ai/api/v1",
  name: "openrouter",
  providerLabel: "OpenRouter",
  modelPrefix: "openrouter",
  extraHeaders: {
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "DevChat",
  },
});

export const nvidiaNim = createExternalProvider({
  envKey: "NVIDIA_NIM_API_KEY",
  envBaseUrl: "NVIDIA_NIM_BASE_URL",
  defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
  name: "nvidia-nim",
  providerLabel: "NVIDIA NIM",
  modelPrefix: "nvidia-nim",
});

export const NVIDIA_NIM_MODELS = [
  {
    id: "nvidia/llama-3.1-nemotron-70b-instruct",
    name: "Llama 3.1 Nemotron 70B",
    ctx: 131072,
  },
  { id: "nvidia/nemotron-4-340b-instruct", name: "Nemotron 4 340B", ctx: 4096 },
  { id: "meta/llama-3.1-405b-instruct", name: "Llama 3.1 405B", ctx: 131072 },
  {
    id: "mistralai/mistral-7b-instruct-v0.3",
    name: "Mistral 7B v0.3",
    ctx: 32768,
  },
  { id: "google/gemma-2b-it", name: "Gemma 2B IT", ctx: 8192 },
];

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

export interface OllamaModelInfo {
  name: string;
  size: number;
  digest: string;
  details?: any;
  modifiedAt: string;
  contextWindow?: number;
}

export const STATIC_MODELS: Record<string, ModelConfig> = {
  // "gpt-4o": {
  //   id: "gpt-4o",
  //   name: "GPT-4o",
  //   provider: "openai",
  //   model: openai("gpt-4o"),
  //   costPer1kInputTokens: 0.005,
  //   costPer1kOutputTokens: 0.015,
  //   maxTokens: 4096,
  //   contextWindow: 128000,
  // },
  // "gpt-4o-mini": {
  //   id: "gpt-4o-mini",
  //   name: "GPT-4o Mini",
  //   provider: "openai",
  //   model: openai("gpt-4o-mini"),
  //   costPer1kInputTokens: 0.00015,
  //   costPer1kOutputTokens: 0.0006,
  //   maxTokens: 4096,
  //   contextWindow: 128000,
  // },
  // "claude-sonnet": {
  //   id: "claude-sonnet",
  //   name: "Claude 3.5 Sonnet",
  //   provider: "anthropic",
  //   model: anthropic("claude-3-5-sonnet-20241022"),
  //   costPer1kInputTokens: 0.003,
  //   costPer1kOutputTokens: 0.015,
  //   maxTokens: 4096,
  //   contextWindow: 200000,
  // },
  // "claude-opus": {
  //   id: "claude-opus",
  //   name: "Claude 3 Opus",
  //   provider: "anthropic",
  //   model: anthropic("claude-3-opus-20250219"),
  //   costPer1kInputTokens: 0.015,
  //   costPer1kOutputTokens: 0.075,
  //   maxTokens: 4096,
  //   contextWindow: 200000,
  // },
  // "gemini-pro": {
  //   id: "gemini-pro",
  //   name: "Gemini 1.5 Pro",
  //   provider: "google",
  //   model: google("gemini-1.5-pro"),
  //   costPer1kInputTokens: 0.00075,
  //   costPer1kOutputTokens: 0.003,
  //   maxTokens: 4096,
  //   contextWindow: 1000000,
  // },
  // "gemini-flash": {
  //   id: "gemini-flash",
  //   name: "Gemini 1.5 Flash",
  //   provider: "google",
  //   model: google("gemini-1.5-flash"),
  //   costPer1kInputTokens: 0.000075,
  //   costPer1kOutputTokens: 0.0003,
  //   maxTokens: 4096,
  //   contextWindow: 1000000,
  // },
};

let ollamaModelCache: Record<string, ModelConfig> = {};
let ollamaModelInfoCache: OllamaModelInfo[] = [];
let ollamaModelsFetchedAt = 0;
const OLLAMA_CACHE_TTL = 30_000; // 30 seconds

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
  return false;
}

function createOllamaModelConfig(modelInfo: OllamaModelInfo): ModelConfig {
  const modelName = modelInfo.name;
  const contextWindow =
    modelInfo.contextWindow ?? getDefaultContextWindow(modelName);
  return {
    id: `ollama/${modelName}`,
    name: modelName.replace(":latest", ""),
    provider: "ollama",
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

export function getOllamaModelInfos(): OllamaModelInfo[] {
  return ollamaModelInfoCache;
}

export async function initializeOpenRouterModels(apiKey?: string): Promise<void> {
  const key = apiKey || process.env[openRouter.envKey] || "";
  if (!key) return;
  if (apiKey) openRouter.setKey(apiKey);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (key) headers["Authorization"] = `Bearer ${key}`;

    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new Error(`OpenRouter API error: ${response.status}`);

    const data = await response.json();
    for (const m of data.data || []) {
      const p = m.pricing || { prompt: "0", completion: "0" };
      const isFree =
        parseFloat(p.prompt) === 0 && parseFloat(p.completion) === 0;
      if (!isFree) continue;
      if (!m.id || !m.id.includes("/")) continue;
      openRouter.addModel(m.id, m.name || m.id, m.context_length || 128000, p);
    }
  } catch (error) {
    console.error("Failed to fetch OpenRouter models:", error);
  }
}

export async function initializeNvidiaNimModels(apiKey?: string): Promise<void> {
  const key = apiKey || process.env.NVIDIA_NIM_API_KEY || "";
  if (!key) return;
  if (apiKey) nvidiaNim.setKey(apiKey);
  const baseUrl =
    process.env.NVIDIA_NIM_BASE_URL || "https://integrate.api.nvidia.com/v1";
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`NVIDIA API error: ${response.status}`);

    const data = await response.json();
    for (const m of data.data || []) {
      if (!m.id) continue;
      nvidiaNim.addModel(m.id, m.id, m.context_length || 128000);
    }
  } catch (error) {
    console.error("Failed to fetch NVIDIA NIM models:", error);
  }
}

export function getAllModels(): ModelConfig[] {
  const staticModels = Object.values(STATIC_MODELS);
  const ollamaModels = Object.values(ollamaModelCache);
  const openRouterModels = Object.values(openRouter.modelCache);
  const nvidiaModels = Object.values(nvidiaNim.modelCache);
  return [
    ...staticModels,
    ...ollamaModels,
    ...openRouterModels,
    ...nvidiaModels,
  ];
}

export function getModel(modelId: string): ModelConfig {
  if (STATIC_MODELS[modelId]) {
    return STATIC_MODELS[modelId];
  }

  if (ollamaModelCache[modelId]) {
    return ollamaModelCache[modelId];
  }

  if (openRouter.modelCache[modelId]) {
    return openRouter.modelCache[modelId];
  }

  if (nvidiaNim.modelCache[modelId]) {
    return nvidiaNim.modelCache[modelId];
  }

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
  }

  if (modelId.startsWith("openrouter/") && openRouter.isAvailable) {
    const bareId = modelId.replace("openrouter/", "");
    openRouter.addModel(bareId, bareId, 128000);
    return openRouter.modelCache[modelId];
  }

  if (modelId.startsWith("nvidia-nim/") && nvidiaNim.isAvailable) {
    const bareId = modelId.replace("nvidia-nim/", "");
    nvidiaNim.addModel(bareId, bareId, 128000);
    return nvidiaNim.modelCache[modelId];
  }

  throw new Error(
    `Model ${modelId} not found. Available: ${[
      ...Object.keys(STATIC_MODELS),
      ...Object.keys(ollamaModelCache),
      ...Object.keys(openRouter.modelCache),
      ...Object.keys(nvidiaNim.modelCache),
    ].join(", ")}`,
  );
}

export async function initializeOllamaModels(): Promise<void> {
  const models = await fetchOllamaModels();
  for (const modelInfo of models) {
    const modelId = `ollama/${modelInfo.name}`;
    ollamaModelCache[modelId] = createOllamaModelConfig(modelInfo);
  }
}

export function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const model = getModel(modelId);
  return (
    (inputTokens / 1000) * model.costPer1kInputTokens +
    (outputTokens / 1000) * model.costPer1kOutputTokens
  );
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

export const STATIC_MODEL_CATALOG: ModelCatalogEntry[] = [
  { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI", contextWindow: 128000 },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "OpenAI",
    contextWindow: 128000,
  },
  {
    id: "claude-sonnet",
    name: "Claude 3.5 Sonnet",
    provider: "Anthropic",
    contextWindow: 200000,
  },
  {
    id: "claude-opus",
    name: "Claude 3 Opus",
    provider: "Anthropic",
    contextWindow: 200000,
  },
  {
    id: "gemini-pro",
    name: "Gemini 1.5 Pro",
    provider: "Google",
    contextWindow: 1000000,
  },
  {
    id: "gemini-flash",
    name: "Gemini 1.5 Flash",
    provider: "Google",
    contextWindow: 1000000,
  },
];

export function getDefaultOllamaContextWindow(modelName: string): number {
  const name = modelName.toLowerCase();
  if (name.includes("llama3.2") || name.includes("llama3.1")) return 131072;
  if (name.includes("llama3")) return 8192;
  if (name.includes("qwen") || name.includes("ministral")) return 32768;
  if (name.includes("gemma")) return 8192;
  if (name.includes("phi3")) return 4096;
  return 8192;
}

export function mergeAndDedupeModels<T extends { id: string }>(
  staticEntries: T[],
  dynamicEntries: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of [...staticEntries, ...dynamicEntries]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}
