import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { findConversationMessage } from "@/lib/api/messages";
import { requireUserId } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const userId = await requireUserId();
    const { id, messageId } = await params;

    const result = await findConversationMessage(id, messageId, userId);
    if (!result.ok) {
      return result.reason === "not_found"
        ? NextResponse.json({ error: "Message not found" }, { status: 404 })
        : NextResponse.json({ error: "Message not in this conversation" }, { status: 400 });
    }
    const target = result.message;

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
