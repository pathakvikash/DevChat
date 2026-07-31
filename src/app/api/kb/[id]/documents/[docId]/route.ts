import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const userId = await requireUserId();
    const { id, docId } = await params;

    const kb = await prisma.knowledgeBase.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!kb || kb.userId !== userId) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Verify document belongs to this KB
    const doc = await prisma.document.findUnique({
      where: { id: docId },
    });

    if (!doc || doc.kbId !== id) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    await prisma.document.delete({
      where: { id: docId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete document:", error);
    return NextResponse.json(
      { error: "Failed to delete document" },
      { status: 500 }
    );
  }
}
