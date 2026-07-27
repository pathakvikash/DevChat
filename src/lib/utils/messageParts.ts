/**
 * Shared types and helpers for AI-SDK `parts`. The same `FilePart` /
 * `ToolPart` shape was previously declared inline in five different files
 * (MessageBubble, MessageContent, ToolInvocation, FileAttachments, and the
 * chat route); keeping it here makes the chat UI consistent and lets the
 * `lib` layer reason about messages without depending on the UI.
 */

export interface FilePart {
  type: "file" | "image";
  mediaType?: string;
  url?: string;
  image?: string;
  filename?: string;
}

export interface ToolPart {
  type: string;
  toolCallId?: string;
  state?: string;
  input?: any;
  output?: any;
  errorText?: string;
}

export interface AnyPart {
  type: string;
  [k: string]: unknown;
}

/** A whole message as it lives in the UI: id, role, parts. */
export interface ChatMessage {
  id: string;
  role: string;
  parts: AnyPart[];
}

/**
 * Concatenate the text portions of a UIMessage-shaped `parts` array.
 * Accepts either `parts: Part[]` (AI SDK v5) or the older
 * `{ content: string }` shape used by some legacy call sites.
 */
export function extractText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as { content?: unknown; parts?: unknown };
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.parts)) {
    return m.parts
      .filter((p: any) => p?.type === "text")
      .map((p: any) => p?.text || "")
      .join("");
  }
  return "";
}

/** Type guard for tool-call parts (type === "tool-<name>"). */
export function isToolPart(part: AnyPart): part is AnyPart & ToolPart {
  return typeof part?.type === "string" && part.type.startsWith("tool-");
}

/**
 * Synthetic marker inserted by `buildMessagesFromConversation` so the
 * chat timeline can show a `CompressionEvent` card at the right point.
 * Not a real AI-SDK role; UI-only.
 */
export interface CompressionEventPart {
  type: "compression-event";
  summary: string;
  compressedAt: string;
  beforeTokens?: number;
  afterTokens?: number;
  reductionPercent?: number;
  beforeMessages?: number;
}

export function findCompressionEvent(
  parts: AnyPart[],
): CompressionEventPart | null {
  const p = parts.find((x) => x?.type === "compression-event");
  return (p as CompressionEventPart | undefined) ?? null;
}

/** Stable id for a tool part: prefer the SDK-assigned `toolCallId`, fall
 *  back to its position in the array so React keys never collide. */
export function toolKey(part: AnyPart & ToolPart, index: number): string {
  return part.toolCallId || `tool-${index}`;
}

/**
 * Group adjacent tool parts by `toolCallId` so a single tool call (the
 * `output-available` part and the later `result` part) renders as one
 * `<ToolInvocation />` instead of two.
 *
 * Pure function, no React. Returns a flat list of either tool-groups or
 * non-tool parts in their original order, suitable for `messages.map`.
 */
export type GroupedItem =
  | { type: "tool-group"; key: string; parts: Array<AnyPart & ToolPart> }
  | { type: "other"; key: string; part: AnyPart; index: number };

export function groupToolParts(parts: AnyPart[]): GroupedItem[] {
  const groups = new Map<string, Array<AnyPart & ToolPart>>();
  const out: GroupedItem[] = [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (isToolPart(p)) {
      const key = toolKey(p, i);
      if (!groups.has(key)) {
        groups.set(key, []);
        out.push({ type: "tool-group", key, parts: groups.get(key)! });
      }
      groups.get(key)!.push(p);
    } else {
      out.push({ type: "other", key: `part-${i}`, part: p, index: i });
    }
  }

  return out;
}

/**
 * Build the AI-SDK `parts` array (and a list of lightweight attachment
 * metadata) for a new user message given the current input text and a
 * set of files the user has attached.
 *
 * Images are converted to data URLs in-browser. Text-y files are read
 * with `FileReader`-equivalent APIs and inlined as code blocks. PDFs and
 * DOCX files are sent to /api/files/extract and the extracted text is
 * appended to the message. Unsupported files get a friendly placeholder
 * line in the prompt.
 *
 * Extracted from `app/c/[id]/page.tsx` so the rule for "how does an
 * attachment turn into model input" lives in one place.
 */

const TEXTY_NAME_RE =
  /\.(md|txt|json|csv|tsv|js|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|hpp|html|css|yml|yaml|xml|sh|sql|toml)$/i;
const SERVER_EXTRACT_NAME_RE = /\.(pdf|docx)$/i;

export interface AttachmentMeta {
  name: string;
  size: number;
  type: string;
}

export interface BuiltMessageParts {
  parts: any[];
  attachments: AttachmentMeta[];
}

function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

function isTexty(file: File): boolean {
  return file.type.startsWith("text/") || TEXTY_NAME_RE.test(file.name);
}

function needsServerExtract(file: File): boolean {
  return (
    SERVER_EXTRACT_NAME_RE.test(file.name) ||
    file.type === "application/pdf" ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error || new Error("Failed to read file"));
    r.readAsDataURL(file);
  });
}

async function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error || new Error("Failed to read file"));
    r.readAsText(file);
  });
}

export async function buildMessageParts(
  input: string,
  files: File[],
  modelId?: string,
): Promise<BuiltMessageParts> {
  const parts: any[] = [];
  const attachments: AttachmentMeta[] = [];
  let extractedText = "";

  for (const file of files) {
    attachments.push({ name: file.name, size: file.size, type: file.type });

    if (isImage(file)) {
      if (file.size > 20 * 1024 * 1024) {
        console.warn(`Image '${file.name}' exceeds 20MB limit, skipping.`);
        continue;
      }
      const dataUrl = await readAsDataUrl(file);
      parts.push({ type: "file", mediaType: file.type, url: dataUrl });
    } else if (needsServerExtract(file)) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        if (modelId) fd.append("modelId", modelId);
        const res = await fetch("/api/files/extract", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) throw new Error(`Extract failed: ${res.status}`);
        const data = await res.json();
        const note = data.truncated ? " (truncated)" : "";
        extractedText += `\n\n--- Attached file: ${file.name}${note} ---\n${data.text}\n--- end of ${file.name} ---`;
      } catch (err: any) {
        extractedText += `\n\n[Attached: ${file.name} — extraction failed: ${err?.message || "unknown error"}]`;
      }
    } else if (isTexty(file)) {
      if (file.size > 5 * 1024 * 1024) {
        console.warn(`Text file '${file.name}' exceeds 5MB limit, skipping.`);
        continue;
      }
      const txt = await readAsText(file);
      extractedText += `\n\n--- Attached file: ${file.name} ---\n\`\`\`\n${txt}\n\`\`\``;
    } else {
      extractedText += `\n\n[Attached: ${file.name} (${file.type || "unknown"}, ${file.size} bytes) — unsupported file type]`;
    }
  }

  const fullText = (input + extractedText).trim();
  if (fullText) {
    parts.unshift({ type: "text", text: fullText });
  }

  return { parts, attachments };
}

/**
 * Strip file/image data URLs from parts for DB persistence.
 * File parts are converted to a text placeholder to avoid storing
 * stale base64 data URLs that providers fail to process on re-send.
 */
export function stripFileParts(parts: any[]): any[] {
  return parts.map((p: any) => {
    if (p.type === "file" || p.type === "image") {
      return { type: "text", text: `[Attached image: ${p.mediaType || "unknown"}]` };
    }
    return p;
  });
}

/** Format a context-window number into a compact human-readable string. */
export function formatContext(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}
