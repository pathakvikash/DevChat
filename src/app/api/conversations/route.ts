import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hasNote = searchParams.get("hasNote") === "true";

    const where = hasNote ? { note: { not: null } } : {};

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
    const {
      title,
      model,
      persona,
      systemPrompt,
      contextLength,
      temperature,
      topP,
      maxTokens,
    } = await req.json();

    const conversation = await prisma.conversation.create({
      data: {
        title: title || "New Chat",
        model,
        persona,
        systemPrompt,
        contextLength: contextLength ?? 8192,
        temperature,
        topP,
        maxTokens,
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
