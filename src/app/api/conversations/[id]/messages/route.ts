import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";

/**
 * DELETE /api/conversations/:id/messages
 *
 * Body / query params (one is required; a bare request is a 400, so a
 * malformed body can never wipe the chat):
 *   - all=1: wipes every message and resets compression state.
 *   - body { fromIds: string[] }: the ids of every message the client cut.
 *     Some may have no row (a send the server rejected, client-only
 *     results), so the earliest saved one is the pivot: it and every
 *     message created after it are deleted. If none was saved, nothing
 *     is deleted. If the pivot is older than `compressedAt`, the summary
 *     would describe deleted messages, so compression state is reset too.
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
    const userId = await requireUserId();
    const { id: conversationId } = await params;
    const afterTimestamp = req.nextUrl.searchParams.get("afterTimestamp");
    const clearAll = req.nextUrl.searchParams.get("all") === "1";

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, userId: true },
    });

    if (!conversation || conversation.userId !== userId) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    if (!afterTimestamp && !clearAll) {
      let body: { fromIds?: unknown } | null = null;
      try {
        body = JSON.parse(await req.text());
      } catch {
        // no body, or not JSON: the 400 below
      }
      const fromIds = body?.fromIds;
      if (!Array.isArray(fromIds) || !fromIds.length || !fromIds.every((x) => typeof x === "string")) {
        return NextResponse.json(
          { error: "Pass ?all=1, afterTimestamp, or a body { fromIds: string[] } (non-empty)" },
          { status: 400 },
        );
      }

      const pivot = await prisma.message.findFirst({
        where: { conversationId, id: { in: fromIds } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });
      if (!pivot) {
        return NextResponse.json({ success: true, deletedMessages: 0 });
      }

      // One transaction; the reset only matches when the pivot is older than `compressedAt`.
      const [{ count: deletedMessages }] = await prisma.$transaction([
        prisma.message.deleteMany({
          where: {
            conversationId,
            createdAt: { gte: pivot.createdAt },
          },
        }),
        prisma.conversation.updateMany({
          where: { id: conversationId, compressedAt: { gt: pivot.createdAt } },
          data: {
            compressedSummary: null,
            compressedAt: null,
            compressedBeforeTokens: null,
            compressedAfterTokens: null,
            compressedBeforeMessages: null,
          },
        }),
      ]);

      return NextResponse.json({ success: true, deletedMessages });
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
    const userId = await requireUserId();
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
      select: { id: true, userId: true },
    });

    if (!conversation || conversation.userId !== userId) {
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
