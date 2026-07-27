import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get("q");

    if (!query || query.length < 2) {
      return NextResponse.json({ error: "Query too short" }, { status: 400 });
    }

    // Search in conversation titles
    const conversations = await prisma.conversation.findMany({
      where: {
        title: ({ contains: query, mode: "insensitive" } as any),
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        model: true,
      },
      take: 20,
    });

    // Search in message content
    const messages = await prisma.message.findMany({
      where: {
        content: ({ contains: query, mode: "insensitive" } as any),
      },
      select: {
        id: true,
        content: true,
        conversationId: true,
        createdAt: true,
        role: true,
      },
      take: 20,
    });

    return NextResponse.json({
      conversations,
      messages: messages.map((m) => ({
        ...m,
        preview: m.content.substring(0, 200),
      })),
      count: conversations.length + messages.length,
    });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
