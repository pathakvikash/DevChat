import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";

/** Fetch by artifact id alone: a rendered spec carries no conversation id.
 *  Ownership goes through the conversation; not-owned is a 404 so ids stay unenumerable. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { artifactId } = await params;

    const artifact = await prisma.artifact.findUnique({
      where: { id: artifactId },
      include: { conversation: { select: { userId: true } } },
    });
    if (!artifact || artifact.conversation.userId !== userId) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    const { id, type, title, content, version } = artifact;
    return NextResponse.json({ id, type, title, content, version });
  } catch (error) {
    console.error("Failed to fetch artifact:", error);
    return NextResponse.json({ error: "Failed to fetch artifact" }, { status: 500 });
  }
}
