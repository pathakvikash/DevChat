import { NextResponse } from "next/server";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

export async function GET() {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json({ models: data.models || [] });
  } catch (error) {
    console.error("Failed to fetch Ollama models:", error);
    return NextResponse.json(
      { error: "Failed to fetch Ollama models. Is Ollama running?", models: [] },
      { status: 503 }
    );
  }
}
