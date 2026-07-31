import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { findConversationMessage } from "@/lib/api/messages";
import { requireUserId } from "@/lib/auth";

function messageLookupErrorResponse(reason: "not_found" | "wrong_conversation") {
  return reason === "not_found"
    ? NextResponse.json({ error: "Message not found" }, { status: 404 })
    : NextResponse.json({ error: "Message not in this conversation" }, { status: 400 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const userId = await requireUserId();
    const { id, messageId } = await params;
    const { content } = await req.json();

    if (!content || typeof content !== "string") {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const result = await findConversationMessage(id, messageId, userId);
    if (!result.ok) return messageLookupErrorResponse(result.reason);

    const updatedMessage = await prisma.message.update({
      where: { id: messageId },
      data: {
        content,
        parts: JSON.stringify([{ type: "text", text: content }]),
      },
    });

    return NextResponse.json({
      id: updatedMessage.id,
      role: updatedMessage.role,
      content: updatedMessage.content,
      parts: [{ type: "text", text: updatedMessage.content }],
      createdAt: updatedMessage.createdAt,
    });
  } catch (error) {
    console.error("Failed to update message:", error);
    return NextResponse.json({ error: "Failed to update message" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const userId = await requireUserId();
    const { id, messageId } = await params;

    const result = await findConversationMessage(id, messageId, userId);
    if (!result.ok) return messageLookupErrorResponse(result.reason);

    await prisma.message.delete({
      where: { id: messageId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete message:", error);
    return NextResponse.json({ error: "Failed to delete message" }, { status: 500 });
  }
}