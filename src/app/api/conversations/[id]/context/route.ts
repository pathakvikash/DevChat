import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { calculateDetailedContextUsage } from "@/lib/tokens";
import { buildSystemPrompt } from "@/lib/chat/buildSystemPrompt";
import { resolveActiveToolIds } from "@/lib/chat/buildTools";
import { getModel } from "@/lib/models";

function parseListParam(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const currentMessage = searchParams.get("currentMessage") || "";
    // enabledTools / enabledSkills live in the client React state (not in
    // the Conversation row), so the panel passes them as query params.
    const explicitToolIds = parseListParam(searchParams.get("enabledTools"));
    const skillIds = parseListParam(searchParams.get("enabledSkills"));

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: { role: true, content: true, createdAt: true },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    let modelConfig;
    try {
      modelConfig = getModel(conversation.model);
    } catch {
      modelConfig = null;
    }
    const contextLength = conversation.contextLength || modelConfig?.contextWindow || 8192;
    const systemPrompt = conversation.systemPrompt || "";
    const compressedSummary = conversation.compressedSummary || null;
    const compressedAt = conversation.compressedAt
      ? new Date(conversation.compressedAt)
      : null;

    // When a compressed summary exists, the live prompt only sees the summary
    // (not the original history), so we don't need to count the pre-compression
    // messages toward the context window at all.
    const messagesForUsage = compressedAt
      ? conversation.messages.filter(
          (m) => new Date(m.createdAt) >= compressedAt,
        )
      : conversation.messages;

    // Re-build the actual system-prompt sections the model will see on the
    // next request, so the per-category counts reflect reality (tools,
    // skills, KB auto-inject, etc.) — not just the raw persona string.
    const chatOnlyMode = conversation.chatOnlyMode ?? false;
    const memoryDisabled = conversation.memoryDisabled ?? false;
    const useTools = !!modelConfig?.supportsTools && !chatOnlyMode;
    const activeToolIds = resolveActiveToolIds(
      explicitToolIds,
      skillIds,
      conversation.kbId,
    );

    // `retrieveKbContext` (called inside buildSystemPrompt) reads the LAST
    // user message from the messages array to embed. For the panel we want
    // the embedding to be against the *current* typed text, so we synthesize
    // a final user message.
    const panelMessages = currentMessage.trim()
      ? [
          ...messagesForUsage,
          { role: "user", content: currentMessage, createdAt: new Date() },
        ]
      : messagesForUsage;

    const { sections } = await buildSystemPrompt({
      useTools,
      systemPrompt,
      skillIds,
      activeToolIds,
      conversationId: id,
      kbId: conversation.kbId || undefined,
      ragContext: undefined,
      messages: panelMessages,
      memoryDisabled,
    });

    const result = calculateDetailedContextUsage(
      sections,
      messagesForUsage,
      currentMessage,
      contextLength,
      compressedSummary
    );

    return NextResponse.json({
      model: conversation.model,
      contextLength,
      systemPrompt: systemPrompt ? systemPrompt.substring(0, 200) : null,
      hasCompressedSummary: !!compressedSummary,
      ...result,
    });
  } catch (error) {
    console.error("Failed to calculate context usage:", error);
    return NextResponse.json(
      { error: "Failed to calculate context usage" },
      { status: 500 }
    );
  }
}