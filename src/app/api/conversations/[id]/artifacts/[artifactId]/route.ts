import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  try {
    const { id, artifactId } = await params;

    const artifact = await prisma.artifact.findUnique({
      where: { id: artifactId },
    });

    if (!artifact) {
      return NextResponse.json(
        { error: "Artifact not found" },
        { status: 404 }
      );
    }

    if (artifact.conversationId !== id) {
      return NextResponse.json(
        { error: "Artifact not in this conversation" },
        { status: 400 }
      );
    }

    return NextResponse.json(artifact);
  } catch (error) {
    console.error("Failed to fetch artifact:", error);
    return NextResponse.json({ error: "Failed to fetch artifact" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  try {
    const { id, artifactId } = await params;
    const { type, title, content } = await req.json();

    const artifact = await prisma.artifact.findUnique({
      where: { id: artifactId },
    });

    if (!artifact) {
      return NextResponse.json(
        { error: "Artifact not found" },
        { status: 404 }
      );
    }

    if (artifact.conversationId !== id) {
      return NextResponse.json(
        { error: "Artifact not in this conversation" },
        { status: 400 }
      );
    }

    const version =
      content !== undefined && content !== artifact.content
        ? artifact.version + 1
        : artifact.version;

    const updated = await prisma.artifact.update({
      where: { id: artifactId },
      data: {
        ...(type !== undefined && { type }),
        ...(title !== undefined && { title }),
        ...(content !== undefined && { content }),
        version,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update artifact:", error);
    return NextResponse.json({ error: "Failed to update artifact" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  try {
    const { id, artifactId } = await params;

    const artifact = await prisma.artifact.findUnique({
      where: { id: artifactId },
    });

    if (!artifact) {
      return NextResponse.json(
        { error: "Artifact not found" },
        { status: 404 }
      );
    }

    if (artifact.conversationId !== id) {
      return NextResponse.json(
        { error: "Artifact not in this conversation" },
        { status: 400 }
      );
    }

    await prisma.artifact.delete({ where: { id: artifactId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete artifact:", error);
    return NextResponse.json({ error: "Failed to delete artifact" }, { status: 500 });
  }
}
