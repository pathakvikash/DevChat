import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";

// Cross-chat index: metadata only (no content), scoped to the caller through conversation.userId.
export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const q = req.nextUrl.searchParams.get("q")?.trim();
    const n = Number(req.nextUrl.searchParams.get("limit"));
    const limit = Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 200) : 100;

    const rows = await prisma.artifact.findMany({
      where: {
        conversation: { userId, temporary: false },
        ...(q ? { title: { contains: q } } : {}), // SQLite LIKE is case-insensitive for ASCII
      },
      select: {
        id: true,
        title: true,
        type: true,
        conversationId: true,
        updatedAt: true,
        conversation: { select: { title: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    const artifacts = rows.map(({ conversation, ...a }) => ({ ...a, conversationTitle: conversation.title }));
    return NextResponse.json({ artifacts });
  } catch (error) {
    console.error("Failed to list artifacts:", error);
    return NextResponse.json({ error: "Failed to list artifacts" }, { status: 500 });
  }
}
