import { NextResponse } from "next/server";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

let cache: { data: any; timestamp: number } | null = null;
const CACHE_TTL = 30_000;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.timestamp < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      headers: {
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    const models = data.models || [];

    const formattedModels = models.map((model: any) => ({
      id: `ollama/${model.name}`,
      name: model.name,
      size: model.size,
      digest: model.digest,
      details: model.details,
      modifiedAt: model.modified_at,
    }));

    const result = {
      models: formattedModels,
      source: "ollama",
      baseUrl: OLLAMA_BASE_URL,
    };
    cache = { data: result, timestamp: now };
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to fetch Ollama models:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch Ollama models. Is Ollama running?",
        models: [],
        source: "ollama",
      },
      { status: 503 }
    );
  }
}