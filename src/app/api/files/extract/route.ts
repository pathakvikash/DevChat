import { NextRequest, NextResponse } from "next/server";
import { getModel } from "@/lib/models";

export const runtime = "nodejs";

/**
 * The hard ceiling, regardless of model. Past this, even the largest local
 * context window can't hold the file plus system prompt plus the model's
 * response — and the network payload itself starts to hurt.
 */
const ABSOLUTE_MAX_CHARS = 200_000;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const modelId = (formData.get("modelId") as string | null) || undefined;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File exceeds the 20 MB size limit." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const name = file.name.toLowerCase();

    let text = "";
    let kind: "pdf" | "docx" | "text" | "unknown" = "unknown";

    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      kind = "pdf";
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
      kind = "docx";
      const mammoth = (await import("mammoth")).default as any;
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || "";
    } else if (file.type.startsWith("text/") || /\.(txt|md|csv|json|yaml|yml|xml|html|js|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|hpp|css|sql|sh|toml)$/i.test(name)) {
      kind = "text";
      text = buffer.toString("utf8");
    } else {
      return NextResponse.json(
        {
          error: `Unsupported file type: ${file.type || name}. Supported: PDF, DOCX, plain text.`,
        },
        { status: 415 }
      );
    }

    // Context-aware cap. Reserve ~60% of the model's context window for the
    // system prompt, the rest of the conversation, the model description
    // overhead, and the response. A rough 4 chars/token means we can send
    // at most `contextWindow * 0.30 * 4` characters of file content.
    let contextWindow = 8192;
    if (modelId) {
      try {
        contextWindow = getModel(modelId).contextWindow;
      } catch {
        // modelId might be unknown to getModel (e.g. deleted). Fall through.
      }
    }
    const perFileCharCap = Math.min(
      ABSOLUTE_MAX_CHARS,
      Math.floor(contextWindow * 0.3 * 4),
    );

    let truncated = false;
    let originalChars = text.length;
    if (text.length > perFileCharCap) {
      text =
        text.slice(0, perFileCharCap) +
        `\n\n[…truncated. Original was ${originalChars.toLocaleString()} chars; only the first ${perFileCharCap.toLocaleString()} were included because this model's context window is ${contextWindow.toLocaleString()} tokens. Ask the user to share the specific section you need, or upload the file to a knowledge base and use searchKnowledgeBase for targeted lookups.]`;
      truncated = true;
    }

    return NextResponse.json({
      filename: file.name,
      kind,
      text,
      truncated,
      chars: text.length,
      originalChars,
      contextWindow,
    });
  } catch (error: any) {
    console.error("File extract error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to extract file" },
      { status: 500 }
    );
  }
}
