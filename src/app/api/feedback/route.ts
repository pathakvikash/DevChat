import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";

export async function PUT(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { messageId, rating } = await req.json();

    if (!messageId || (rating !== 1 && rating !== -1)) {
      return new Response(
        JSON.stringify({ error: "messageId and rating (1 or -1) required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { conversation: { select: { userId: true } } },
    });
    if (!message || message.conversation.userId !== userId) {
      return new Response(JSON.stringify({ error: "Message not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const existing = await prisma.feedback.findUnique({
      where: { messageId },
    });

    let feedback;
    if (existing) {
      if (existing.rating === rating) {
        // Toggle off: same rating clicked again
        feedback = await prisma.feedback.delete({
          where: { id: existing.id },
        });
        return new Response(
          JSON.stringify({ feedback: null, removed: true }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      feedback = await prisma.feedback.update({
        where: { id: existing.id },
        data: { rating },
      });
    } else {
      feedback = await prisma.feedback.create({
        data: { messageId, rating },
      });
    }

    return new Response(JSON.stringify({ feedback }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Feedback API error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to save feedback" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}