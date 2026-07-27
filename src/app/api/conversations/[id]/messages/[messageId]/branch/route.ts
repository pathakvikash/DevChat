import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const { id, messageId } = await params;

    const target = await prisma.message.findUnique({
      where: { id: messageId },
      select: { conversationId: true, createdAt: true },
    });

    if (!target) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    if (target.conversationId !== id) {
      return NextResponse.json({ error: "Message not in this conversation" }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.message.deleteMany({
        where: {
          conversationId: id,
          createdAt: { gte: target.createdAt },
        },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to branch messages:", error);
    return NextResponse.json({ error: "Failed to branch messages" }, { status: 500 });
  }
}
