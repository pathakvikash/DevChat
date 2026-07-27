import { NextResponse } from "next/server";
import {
  getDefaultOllamaContextWindow,
  fetchOllamaModels,
  getOllamaModelInfos,
  getSupportsTools,
  getSupportsVision,
  getSupportsThinking,
  initializeOpenRouterModels,
  initializeNvidiaNimModels,
  nvidiaNim,
  type ModelCatalogEntry,
  type OllamaModelInfo,
} from "@/lib/models";

export async function GET(req: Request) {
  let ollamaModels: ModelCatalogEntry[] = [];

  try {
    await fetchOllamaModels();
    const modelInfos = getOllamaModelInfos();
    ollamaModels = modelInfos.map((model: OllamaModelInfo) => ({
      id: `ollama/${model.name}`,
      name: model.name.replace(":latest", ""),
      provider: "Ollama",
      contextWindow: model.contextWindow ?? getDefaultOllamaContextWindow(model.name),
      supportsTools: getSupportsTools(model.name),
      supportsVision: getSupportsVision(model.name),
      supportsThinking: getSupportsThinking(model.name),
    }));
  } catch (error) {
    console.warn("Ollama unavailable, using static models only:", error);
  }

  const openrouterApiKey = req.headers.get("x-openrouter-api-key") || process.env.OPENROUTER_API_KEY;
  const nvidiaNimApiKey = req.headers.get("x-nvidia-nim-api-key") || process.env.NVIDIA_NIM_API_KEY;

  let openRouterModels: ModelCatalogEntry[] = [];
  if (openrouterApiKey) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openrouterApiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json();
        openRouterModels = (data.data || [])
          .filter((m: any) => {
            const p = m.pricing || { prompt: "0", completion: "0" };
            return parseFloat(p.prompt) === 0 && parseFloat(p.completion) === 0;
          })
          .filter((m: any) => m.id && m.id.includes("/"))
          .map((m: any) => ({
            id: `openrouter/${m.id}`,
            name: m.name || m.id,
            provider: "OpenRouter",
            contextWindow: m.context_length || 128000,
            supportsTools: getSupportsTools(m.id) || getSupportsTools(m.name || "") || !m.id?.toLowerCase().includes("instruct"),
            supportsVision: getSupportsVision(m.id) || getSupportsVision(m.name || ""),
            supportsThinking: getSupportsThinking(m.id) || getSupportsThinking(m.name || ""),
          }));
      }
    } catch (error) {
      console.warn("OpenRouter unavailable:", error);
    }
  }

  let nvidiaModels: ModelCatalogEntry[] = [];
  if (nvidiaNimApiKey) {
    await initializeNvidiaNimModels(nvidiaNimApiKey);
    nvidiaModels = nvidiaNim.modelCatalog.slice();
  }

  const deduped = new Map<string, ModelCatalogEntry>();
  for (const m of [...ollamaModels, ...openRouterModels, ...nvidiaModels]) {
    if (!deduped.has(m.id)) deduped.set(m.id, m);
  }
  const allModels = Array.from(deduped.values());

  return NextResponse.json({
    models: allModels,
    ollamaAvailable: ollamaModels.length > 0,
  });
}
