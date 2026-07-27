import { NextRequest, NextResponse } from "next/server";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json();
    if (!name) {
      return NextResponse.json({ error: "Model name is required" }, { status: 400 });
    }

    const response = await fetch(`${OLLAMA_BASE_URL}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: `Ollama delete failed: ${error}` },
        { status: response.status },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete Ollama model:", error);
    return NextResponse.json(
      { error: "Failed to delete Ollama model" },
      { status: 500 },
    );
  }
}
