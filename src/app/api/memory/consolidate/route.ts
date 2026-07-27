import { NextRequest, NextResponse } from "next/server";
import { consolidateMemory } from "@/lib/memory";

export const maxDuration = 60;

/**
 * Manually trigger long-term memory consolidation for a conversation: extract
 * durable facts, merge/reinforce existing ones, and prune stale low-value
 * facts. Also runs automatically after each Goal Mode run.
 */
export async function POST(req: NextRequest) {
  try {
    const { conversationId, model } = await req.json();
    if (!conversationId || typeof conversationId !== "string") {
      return NextResponse.json(
        { error: "conversationId is required" },
        { status: 400 },
      );
    }
    const result = await consolidateMemory({ conversationId, modelId: model });
    return NextResponse.json(result);
  } catch (e) {
    console.error("Memory consolidation failed:", e);
    return NextResponse.json(
      { error: "Failed to consolidate memory" },
      { status: 500 },
    );
  }
}
