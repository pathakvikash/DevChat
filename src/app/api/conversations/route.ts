import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getSettingsKey } from "@/lib/settings";
import { requireUserId } from "@/lib/auth";
import { deleteExpiredTemporaryChats } from "@/lib/temporaryChat";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const hasNote = searchParams.get("hasNote") === "true";

    try {
      await deleteExpiredTemporaryChats(userId);
    } catch (e) {
      console.error("Temporary chat cleanup failed:", e); // never let it break the list
    }
    const where = { userId, temporary: false, ...(hasNote ? { note: { not: null } } : {}) };

    const conversations = await prisma.conversation.findMany({
      select: {
        id: true,
        title: true,
        model: true,
        note: true,
        pinned: true,
        archived: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { messages: true },
        },
      },
      where,
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    });

    return NextResponse.json(conversations);
  } catch (error) {
    console.error("Failed to fetch conversations:", error);
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const {
      title,
      model: bodyModel,
      persona,
      systemPrompt,
      contextLength,
      temperature,
      topP,
      maxTokens,
      temporary,
    } = await req.json();

    const model = bodyModel || await getSettingsKey(userId, "defaultModel") || undefined;

    const conversation = await prisma.conversation.create({
      data: {
        userId,
        title: title || "New Chat",
        model,
        persona,
        systemPrompt,
        contextLength: contextLength ?? 8192,
        temperature,
        topP,
        maxTokens,
        temporary: temporary === true,
      },
    });

    return NextResponse.json(conversation, { status: 201 });
  } catch (error) {
    console.error("Failed to create conversation:", error);
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 },
    );
  }
}
