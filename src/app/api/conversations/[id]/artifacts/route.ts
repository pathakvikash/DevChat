import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const artifacts = await prisma.artifact.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ artifacts });
  } catch (error) {
    console.error("Failed to fetch artifacts:", error);
    return NextResponse.json({ error: "Failed to fetch artifacts" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { type, title, content } = await req.json();

    if (!type || !title || !content) {
      return NextResponse.json(
        { error: "type, title, and content are required" },
        { status: 400 }
      );
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const artifact = await prisma.artifact.create({
      data: { conversationId: id, type, title, content },
    });

    return NextResponse.json(artifact, { status: 201 });
  } catch (error) {
    console.error("Failed to create artifact:", error);
    return NextResponse.json({ error: "Failed to create artifact" }, { status: 500 });
  }
}
