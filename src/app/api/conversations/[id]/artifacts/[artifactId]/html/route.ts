import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  try {
    const { id, artifactId } = await params;

    const artifact = await prisma.artifact.findUnique({
      where: { id: artifactId },
    });

    if (!artifact) {
      return new NextResponse("Artifact not found", { status: 404 });
    }

    if (artifact.conversationId !== id) {
      return new NextResponse("Artifact not in this conversation", { status: 400 });
    }

    if (artifact.type !== "html") {
      return new NextResponse("Artifact is not HTML", { status: 400 });
    }

    return new NextResponse(artifact.content, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("Failed to serve HTML artifact:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
