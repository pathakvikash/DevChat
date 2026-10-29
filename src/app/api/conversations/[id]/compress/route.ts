import { NextRequest, NextResponse } from "next/server";
import {
  compressConversation,
  saveCompressedSummary,
} from "@/lib/compression";
import { getConversationOrNull } from "@/lib/api/conversations";
import { requireUserId } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUserId();
    const { id } = await params;

    const conversation = await getConversationOrNull(id, userId);

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    console.log(
      `[Manual-compress] Starting compression for ${id} with model ${conversation.model}`,
    );
    // The body is optional: ContextDetailsPanel's compress button sends none.
    const { focus } = (await req.json().catch(() => null)) ?? {};
    const result = await compressConversation(id, conversation.model, {
      focus: typeof focus === "string" ? focus : undefined,
      abortSignal: req.signal,
    });
    if (!result) {
      return NextResponse.json(
        { error: "Failed to generate summary" },
        { status: 500 },
      );
    }

    await saveCompressedSummary(id, result.summary, {
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens,
      beforeMessages: result.beforeMessages,
    });
    console.log(`[Manual-compress] Summary saved`);

    return NextResponse.json({
      success: true,
      summary: result.summary,
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens,
      beforeMessages: result.beforeMessages,
      reductionTokens: result.reductionTokens,
      reductionPercent: result.reductionPercent,
    });
  } catch (error) {
    console.error("Failed to compress conversation:", error);
    return NextResponse.json(
      { error: "Failed to compress conversation" },
      { status: 500 },
    );
  }
}
