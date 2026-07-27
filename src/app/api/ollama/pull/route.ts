import { NextRequest } from "next/server";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json();
    if (!name) {
      return new Response(
        JSON.stringify({ error: "Model name is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const ollamaResponse = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (!ollamaResponse.ok) {
      const error = await ollamaResponse.text();
      return new Response(
        JSON.stringify({ error: `Ollama pull failed: ${error}` }),
        { status: ollamaResponse.status, headers: { "Content-Type": "application/json" } },
      );
    }

    const reader = ollamaResponse.body?.getReader();
    if (!reader) {
      return new Response(
        JSON.stringify({ error: "No response body from Ollama" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch (e) {
          controller.error(e);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson" },
    });
  } catch (error) {
    console.error("Failed to pull Ollama model:", error);
    return new Response(
      JSON.stringify({ error: "Failed to pull Ollama model" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
