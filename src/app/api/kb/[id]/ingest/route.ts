import { prisma } from "@/lib/db";
import { chunkText, embed } from "@/lib/rag";
import { extractKnownFileText, validateFileSize } from "@/lib/file-extract";
import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUserId();
    const { id } = await params;

    const kb = await prisma.knowledgeBase.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!kb || kb.userId !== userId) {
      return NextResponse.json({ error: "Knowledge base not found" }, { status: 404 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const sizeError = validateFileSize(file);
    if (sizeError) {
      return NextResponse.json({ error: sizeError }, { status: 400 });
    }

    // Extract text (handles PDF / DOCX / plain text)
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const known = await extractKnownFileText(file, arrayBuffer, buffer);
    const text = known ? known.text : buffer.toString("utf8");

    if (!text.trim()) {
      return NextResponse.json(
        { error: "Could not extract any text from the file" },
        { status: 400 }
      );
    }

    // Chunk the text
    const chunks = chunkText(text, 512, 50);

    // Embed all chunks (parallel, with concurrency cap)
    const embeddedChunks = await Promise.all(
      chunks.map(async (chunk, index) => ({
        text: chunk,
        embedding: await embed(chunk),
        index,
      }))
    );

    // Save to database
    const doc = await prisma.document.create({
      data: {
        kbId: id,
        filename: file.name,
        content: text,
        chunks: JSON.stringify(embeddedChunks),
      },
    });

    return NextResponse.json({
      success: true,
      document: doc,
      chunksCount: chunks.length,
    });
  } catch (error) {
    console.error("Failed to ingest document:", error);
    return NextResponse.json({ error: "Failed to ingest document" }, { status: 500 });
  }
}
