import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { prisma } from "@/lib/db";
import { resolveModel } from "@/lib/llm";
import { getConversationOrNull } from "@/lib/api/conversations";
import { requireUserId } from "@/lib/auth";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUserId();
    const { id } = await params;

    const conversation = await getConversationOrNull(id, userId);

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

    // Conversation's own model first, then any model this user can reach.
    let resolved;
    try {
      resolved = await resolveModel(conversation.model, userId);
    } catch {
      console.warn("[generate-title] No models available for title generation");
      return NextResponse.json({ title: "New Chat" });
    }
    const isOllama = resolved.id.startsWith("ollama/");

    const prompt = messages
      .map((m) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    const result = await generateText({
      model: resolved.model,
      system: "Generate a very short title (max 6 words, no quotes, no punctuation at end) for this conversation based on its beginning. Reply with ONLY the title.",
      prompt,
      temperature: 0.5,
      abortSignal: AbortSignal.timeout(60_000), // a CLI model has no Stop button here
      ...(isOllama ? { providerOptions: { ollama: { num_predict: 20, temperature: 0.5 } } } : {}),
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
