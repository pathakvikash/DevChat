import { NextRequest, NextResponse } from "next/server";
import { consolidateMemory } from "@/lib/memory";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";

export const maxDuration = 60;

/**
 * Manually trigger long-term memory consolidation for a conversation: extract
 * durable facts, merge/reinforce existing ones, and prune stale low-value
 * facts. Also runs automatically after each Goal Mode run.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { conversationId, model } = await req.json();
    if (!conversationId || typeof conversationId !== "string") {
      return NextResponse.json(
        { error: "conversationId is required" },
        { status: 400 },
      );
    }
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    if (!conv || conv.userId !== userId) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const result = await consolidateMemory({ conversationId, userId, modelId: model });
    return NextResponse.json(result);
  } catch (e) {
    console.error("Memory consolidation failed:", e);
    return NextResponse.json(
      { error: "Failed to consolidate memory" },
      { status: 500 },
    );
  }
}
