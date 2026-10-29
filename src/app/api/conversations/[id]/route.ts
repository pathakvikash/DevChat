import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { isRunnableCwd } from "@/lib/claude/sessions";

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
    const { title, model, persona, systemPrompt, webSearch, temperature, maxTokens, kbId, contextLength, topP, chatOnlyMode, memoryDisabled, temporary, pinned, archived, note, maxToolCalls, fallbackModel, reasoningEffort, workingFolder } =
      await req.json();

    if (temporary !== undefined && typeof temporary !== "boolean") {
      return NextResponse.json({ error: "temporary must be a boolean" }, { status: 400 });
    }

    if (memoryDisabled !== undefined && typeof memoryDisabled !== "boolean") {
      return NextResponse.json({ error: "memoryDisabled must be a boolean" }, { status: 400 });
    }

    // A working folder lets a CLI-backed model read (or, in agent mode, edit)
    // files there, so it is confined to folders Claude Code already knows.
    if (workingFolder && !(await isRunnableCwd(workingFolder))) {
      return NextResponse.json(
        { error: "Working folder must be one of your Claude Code project folders" },
        { status: 400 },
      );
    }

    if (kbId) {
      const kb = await prisma.knowledgeBase.findUnique({
        where: { id: kbId },
        select: { userId: true },
      });
      if (!kb || kb.userId !== userId) {
        return NextResponse.json({ error: "Knowledge base not found" }, { status: 404 });
      }
    }

    // A chat can only become temporary before its first message.
    const conversation = await prisma.conversation.updateMany({
      where: { id, userId, ...(temporary === true && { messages: { none: {} } }) },
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
        ...(memoryDisabled !== undefined && { memoryDisabled }),
        ...(temporary !== undefined && { temporary }),
        ...(pinned !== undefined && { pinned }),
        ...(archived !== undefined && { archived }),
        ...(note !== undefined && { note }),
        ...(maxToolCalls !== undefined && { maxToolCalls }),
        ...(fallbackModel !== undefined && { fallbackModel: fallbackModel || null }),
        ...(reasoningEffort !== undefined && { reasoningEffort: reasoningEffort || null }),
        ...(workingFolder !== undefined && { workingFolder: workingFolder || null }),
      },
    });

    if (conversation.count === 0) {
      const exists = temporary === true && (await prisma.conversation.findFirst({ where: { id, userId }, select: { id: true } }));
      return exists
        ? NextResponse.json({ error: "Only a chat with no messages can become temporary" }, { status: 409 })
        : NextResponse.json({ error: "Conversation not found" }, { status: 404 });
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

    // ?temporary=1 (the leave path) never deletes a chat that is no longer temporary.
    const where = { id, userId, ...(new URL(req.url).searchParams.get("temporary") === "1" && { temporary: true }) };
    const chat = await prisma.conversation.findFirst({ where, select: { temporary: true } });
    // Traces hold no foreign key, so a temporary chat's have to go explicitly.
    if (chat?.temporary) await prisma.trace.deleteMany({ where: { conversationId: id } });

    const result = await prisma.conversation.deleteMany({ where });

    if (result.count === 0) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete conversation:", error);
    return NextResponse.json({ error: "Failed to delete conversation" }, { status: 500 });
  }
}
