import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { conversationToMarkdown } from "@/lib/exportMarkdown";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const format = req.nextUrl.searchParams.get("format") || "markdown";

    // The artifacts lookup runs alongside; it is only read after the ownership check below.
    const [conversation, artifacts] = await Promise.all([
      prisma.conversation.findUnique({
        where: { id },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      }),
      format === "json"
        ? []
        : prisma.artifact.findMany({
            where: { conversationId: id },
            select: { id: true, title: true, type: true },
          }),
    ]);

    if (!conversation || conversation.userId !== userId) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    let content = "";

    if (format === "json") {
      const compressedAt = conversation.compressedAt
        ? new Date(conversation.compressedAt)
        : null;
      const messagesToExport = compressedAt
        ? conversation.messages.filter(
            (m) => new Date(m.createdAt) >= compressedAt,
          )
        : conversation.messages;
      const exportPayload = {
        ...conversation,
        messages: messagesToExport,
        ...(compressedAt && conversation.compressedSummary
          ? {
              compressedSummary: conversation.compressedSummary,
              compressedAt: conversation.compressedAt,
            }
          : {}),
      };
      content = JSON.stringify(exportPayload, null, 2);
    } else {
      content = conversationToMarkdown(conversation, artifacts);
    }

    const safeTitle = (conversation.title || "conversation").replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "conversation";
    const filename = `${safeTitle}.${format === "json" ? "json" : "md"}`;

    return new NextResponse(content, {
      headers: {
        "Content-Type": format === "json" ? "application/json" : "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Failed to export conversation:", error);
    return NextResponse.json({ error: "Failed to export conversation" }, { status: 500 });
  }
}
