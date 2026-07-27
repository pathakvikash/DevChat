import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

/**
 * DELETE /api/conversations/:id/messages
 *
 * Query params:
 *   - (none): wipes every message and resets compression state.
 *   - fromMessageId=<id>: deletes the given message and every message
 *     created after it. The conversation and compression state are
 *     preserved.
 *   - afterTimestamp=<ISO string>: deletes every message created after
 *     the given timestamp. Uses the message's `createdAt` field for
 *     comparison (strictly greater than). Useful when client-side IDs
 *     don't match server-side IDs (e.g. regeneration with AI SDK temp
 *     IDs).
 *
 * Returns the deleted count.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;
    const fromMessageId = req.nextUrl.searchParams.get("fromMessageId");
    const afterTimestamp = req.nextUrl.searchParams.get("afterTimestamp");

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    if (fromMessageId) {
      const pivot = await prisma.message.findUnique({
        where: { id: fromMessageId },
        select: { createdAt: true },
      });
      if (!pivot) {
        return NextResponse.json(
          { error: "Message not found" },
          { status: 404 },
        );
      }

      const { count: deletedMessages } = await prisma.message.deleteMany({
        where: {
          conversationId,
          createdAt: { gte: pivot.createdAt },
        },
      });

      return NextResponse.json({ success: true, deletedMessages, fromMessageId });
    }

    if (afterTimestamp) {
      const since = new Date(afterTimestamp);
      if (isNaN(since.getTime())) {
        return NextResponse.json(
          { error: "Invalid afterTimestamp — must be an ISO 8601 string" },
          { status: 400 },
        );
      }
      const { count: deletedMessages } = await prisma.message.deleteMany({
        where: {
          conversationId,
          createdAt: { gt: since },
        },
      });
      return NextResponse.json({ success: true, deletedMessages, afterTimestamp });
    }

    const { count: deletedMessages } = await prisma.message.deleteMany({
      where: { conversationId },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        compressedSummary: null,
        compressedAt: null,
        compressedBeforeTokens: null,
        compressedAfterTokens: null,
        compressedBeforeMessages: null,
        totalTokens: 0,
      },
    });

    return NextResponse.json({
      success: true,
      deletedMessages,
    });
  } catch (error) {
    console.error("Failed to clear history:", error);
    return NextResponse.json(
      { error: "Failed to clear history" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;
    const body = await req.json();
    const {
      id: clientId,
      role,
      content,
      parts,
      attachments,
      model,
      inputTokens = 0,
      outputTokens = 0,
    } = body || {};

    if (!role || !["user", "assistant", "system"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    if (typeof content !== "string") {
      return NextResponse.json({ error: "content must be a string" }, { status: 400 });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const partsJson = Array.isArray(parts) ? JSON.stringify(parts) : null;
    const attachmentsJson =
      Array.isArray(attachments) && attachments.length > 0
        ? JSON.stringify(attachments)
        : null;

    let saved;
    if (clientId) {
      const existing = await prisma.message.findUnique({ where: { id: clientId } });
      if (existing && existing.conversationId === conversationId) {
        saved = await prisma.message.update({
          where: { id: clientId },
          data: {
            role,
            content,
            parts: partsJson,
            attachments: attachmentsJson,
            model: model ?? existing.model,
            inputTokens: inputTokens || existing.inputTokens,
            outputTokens: outputTokens || existing.outputTokens,
          },
        });
      }
    }

    if (!saved) {
      saved = await prisma.message.create({
        data: {
          ...(clientId ? { id: clientId } : {}),
          conversationId,
          role,
          content,
          parts: partsJson,
          attachments: attachmentsJson,
          model: model ?? null,
          inputTokens,
          outputTokens,
        },
      });
    }

    if (inputTokens || outputTokens) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          totalTokens: { increment: inputTokens + outputTokens },
        },
      });
    }

    return NextResponse.json({
      id: saved.id,
      role: saved.role,
      content: saved.content,
      parts: saved.parts ? JSON.parse(saved.parts) : null,
      attachments: saved.attachments ? JSON.parse(saved.attachments) : null,
      model: saved.model,
      inputTokens: saved.inputTokens,
      outputTokens: saved.outputTokens,
      createdAt: saved.createdAt,
    });
  } catch (error) {
    console.error("Failed to save message:", error);
    return NextResponse.json({ error: "Failed to save message" }, { status: 500 });
  }
}
