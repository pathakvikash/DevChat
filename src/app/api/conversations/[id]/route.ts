import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: { feedback: true },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json(conversation);
  } catch (error) {
    console.error("Failed to fetch conversation:", error);
    return NextResponse.json({ error: "Failed to fetch conversation" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { title, model, persona, systemPrompt, webSearch, temperature, maxTokens, kbId, contextLength, topP, chatOnlyMode, pinned, archived, note, maxToolCalls, fallbackModel } =
      await req.json();

    const conversation = await prisma.conversation.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(model !== undefined && { model }),
        ...(persona !== undefined && { persona }),
        ...(systemPrompt !== undefined && { systemPrompt }),
        ...(webSearch !== undefined && { webSearch }),
        ...(temperature !== undefined && { temperature }),
        ...(maxTokens !== undefined && { maxTokens }),
        ...(kbId !== undefined && { kbId: kbId || null }),
        ...(contextLength !== undefined && { contextLength }),
        ...(topP !== undefined && { topP }),
        ...(chatOnlyMode !== undefined && { chatOnlyMode }),
        ...(pinned !== undefined && { pinned }),
        ...(archived !== undefined && { archived }),
        ...(note !== undefined && { note }),
        ...(maxToolCalls !== undefined && { maxToolCalls }),
        ...(fallbackModel !== undefined && { fallbackModel: fallbackModel || null }),
      },
    });

    return NextResponse.json(conversation);
  } catch (error) {
    console.error("Failed to update conversation:", error);
    return NextResponse.json({ error: "Failed to update conversation" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    await prisma.conversation.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete conversation:", error);
    return NextResponse.json({ error: "Failed to delete conversation" }, { status: 500 });
  }
}
