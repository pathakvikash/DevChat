import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
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

    if (!conversation || conversation.userId !== userId) {
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
    const userId = await requireUserId();
    const { id } = await params;
    const { title, model, persona, systemPrompt, webSearch, temperature, maxTokens, kbId, contextLength, topP, chatOnlyMode, pinned, archived, note, maxToolCalls, fallbackModel } =
      await req.json();

    if (kbId) {
      const kb = await prisma.knowledgeBase.findUnique({
        where: { id: kbId },
        select: { userId: true },
      });
      if (!kb || kb.userId !== userId) {
        return NextResponse.json({ error: "Knowledge base not found" }, { status: 404 });
      }
    }

    const conversation = await prisma.conversation.updateMany({
      where: { id, userId },
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

    if (conversation.count === 0) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const updated = await prisma.conversation.findUnique({ where: { id } });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update conversation:", error);
    return NextResponse.json({ error: "Failed to update conversation" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;

    const result = await prisma.conversation.deleteMany({
      where: { id, userId },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete conversation:", error);
    return NextResponse.json({ error: "Failed to delete conversation" }, { status: 500 });
  }
}
