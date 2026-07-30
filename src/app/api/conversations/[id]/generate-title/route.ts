import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { prisma } from "@/lib/db";
import { getModel, getAllModels, initializeOllamaModels, type ModelConfig } from "@/lib/models";
import { getConversationOrNull } from "@/lib/api/conversations";

async function resolveTitleModel(
  preferredModelId: string | null,
): Promise<{ model: ModelConfig; isOllama: boolean } | null> {
  // Try the conversation's own model first
  if (preferredModelId) {
    try {
      const m = getModel(preferredModelId);
      return { model: m, isOllama: preferredModelId.startsWith("ollama/") };
    } catch {
      // Not cached yet; will refresh below
    }
  }

  // Refresh Ollama model list and retry
  await initializeOllamaModels();

  if (preferredModelId) {
    try {
      const m = getModel(preferredModelId);
      return { model: m, isOllama: preferredModelId.startsWith("ollama/") };
    } catch {
      // Model still not found
    }
  }

  // Fall back to any available Ollama model
  const available = getAllModels();
  const ollamaModel = available.find((m) => m.id.startsWith("ollama/"));
  if (ollamaModel) {
    try {
      const m = getModel(ollamaModel.id);
      return { model: m, isOllama: true };
    } catch {
      // ignore
    }
  }

  // Last resort: any available model
  const fallback = available[0];
  if (fallback) {
    try {
      const m = getModel(fallback.id);
      return { model: m, isOllama: false };
    } catch {
      return null;
    }
  }

  return null;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const conversation = await getConversationOrNull(id);

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: "asc" },
      take: 3,
      select: { role: true, content: true },
    });

    if (messages.length === 0) {
      return NextResponse.json({ title: "New Chat" });
    }

    const resolved = await resolveTitleModel(conversation.model);
    if (!resolved) {
      console.warn("[generate-title] No models available for title generation");
      return NextResponse.json({ title: "New Chat" });
    }

    const prompt = messages
      .map((m) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    const result = await generateText({
      model: resolved.model.model,
      system: "Generate a very short title (max 6 words, no quotes, no punctuation at end) for this conversation based on its beginning. Reply with ONLY the title.",
      prompt,
      temperature: 0.5,
      ...(resolved.isOllama ? { providerOptions: { ollama: { num_predict: 20, temperature: 0.5 } } } : {}),
    });

    const title = (result.text || "").trim().replace(/^["']|["']$/g, "") || "New Chat";

    await prisma.conversation.update({
      where: { id },
      data: { title },
    });

    return NextResponse.json({ title });
  } catch (error) {
    console.error("Failed to generate title:", error);
    return NextResponse.json({ title: "New Chat" });
  }
}