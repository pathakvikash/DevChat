import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  compressConversation,
  saveCompressedSummary,
} from "@/lib/compression";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      select: { id: true, model: true },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    console.log(
      `[Manual-compress] Starting compression for ${id} with model ${conversation.model}`,
    );
    const result = await compressConversation(id, conversation.model);
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
