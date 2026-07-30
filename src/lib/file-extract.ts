export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Returns an error message if `file` exceeds the shared upload size limit, else `null`. */
export function validateFileSize(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return "File exceeds the 20 MB size limit.";
  return null;
}

export type KnownFileKind = "pdf" | "docx";

/**
 * Extracts raw text from a PDF or DOCX file. Returns `null` for any other
 * file type so callers can decide their own fallback (plain-text passthrough,
 * a 415 response, etc).
 */
export async function extractKnownFileText(
  file: File,
  arrayBuffer: ArrayBuffer,
  buffer: Buffer,
): Promise<{ kind: KnownFileKind; text: string } | null> {
  const name = file.name.toLowerCase();

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
    return { kind: "pdf", text: result.text || "" };
  }

  if (
    name.endsWith(".docx") ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const mammoth = (await import("mammoth")).default as any;
    const result = await mammoth.extractRawText({ buffer });
    return { kind: "docx", text: result.value || "" };
  }

  return null;
}
