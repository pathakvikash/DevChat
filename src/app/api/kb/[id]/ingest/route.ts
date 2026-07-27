import { prisma } from "@/lib/db";
import { chunkText, embed } from "@/lib/rag";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File exceeds the 20 MB size limit." },
        { status: 400 }
      );
    }

    // Extract text (handles PDF / DOCX / plain text)
    const name = file.name.toLowerCase();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    let text = "";

    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      const path = await import("path");
      const { pathToFileURL } = await import("url");
      const workerPath = path.join(
        process.cwd(),
        "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
      );
      const { PDFParse } = await import("pdf-parse");
      PDFParse.setWorker(pathToFileURL(workerPath).href);
      const parser = new PDFParse({
        data: new Uint8Array(arrayBuffer),
        useWorkerFetch: false,
        isEvalSupported: false,
      });
      const result = await parser.getText();
      text = result.text || "";
    } else if (
      name.endsWith(".docx") ||
      file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const mammoth = (await import("mammoth")).default as any;
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || "";
    } else {
      text = buffer.toString("utf8");
    }

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
