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
  /** Set while a call waits for the user, and after an answer (approval states). */
  approval?: { id?: string; approved?: boolean; reason?: string };
}

export interface AnyPart {
  type: string;
  [k: string]: unknown;
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

/** The answer to a `presentPlan` card, sent back to the model as the tool's output. */
export type PlanDecision =
  | { action: "approve"; mode: "ask" | "agent" }
  | { action: "revise"; feedback: string };

/** The id of the plan card still waiting for an answer in the latest message, if any. */
export function waitingPlanCallId(messages: Array<{ role?: string; parts?: unknown }>): string | undefined {
  const last = messages[messages.length - 1];
  if (last?.role !== "assistant" || !Array.isArray(last.parts)) return undefined;
  const plan = (last.parts as any[]).find((p) => p?.type === "tool-presentPlan" && p.state === "input-available");
  return typeof plan?.toolCallId === "string" ? plan.toolCallId : undefined;
}

/** Denial reason for an approval the user never answered (shown as "Not answered"). */
export const NOT_ANSWERED = "The user did not answer this request.";

/** Only the latest message can still be answered. Older approval cards and plan cards show as
 *  settled (the model gets the same denial from normalizeToolParts, so nothing here is sent back). */
export function settleStaleParts<T extends { type?: string; state?: string; approval?: any }>(
  parts: T[],
  isLatest: boolean,
): T[] {
  if (isLatest) return parts;
  return parts.map((p) => {
    if (p?.state === "approval-requested") {
      return { ...p, state: "output-denied", approval: { id: p.approval?.id, approved: false, reason: NOT_ANSWERED } };
    }
    if (p?.type === "tool-presentPlan" && p.state === "input-available") {
      return { ...p, state: "output-denied", approval: { approved: false, reason: "Replaced by a newer plan" } };
    }
    return p;
  });
}

/** Approval reasons the page writes: shown as "Allowed for this chat", "Denied", "Stopped". */
export const ALLOWED_FOR_CHAT = "Allowed for this chat";
export const DENIED_BY_USER = "The user denied this action.";
export const STOPPED_REPLY = "The reply was stopped before this ran.";

/** Card title by tool, as UX 3.10 lists them. */
export function approvalTitle(toolName: string, input: any): string {
  const i = input ?? {};
  if (toolName === "createArtifact") return `Create artifact "${i.title ?? "Untitled"}"`;
  if (toolName === "updateArtifact") return `Update artifact "${i.title ?? i.artifactId ?? ""}"`;
  if (toolName === "createTodo" || toolName === "createTodos" || toolName === "updateTodo") return "Update the todo list";
  if (toolName === "rememberFact") return `Save to memory: "${i.key ?? ""}"`;
  if (toolName === "forgetFact") return `Forget memory: "${i.key ?? ""}"`;
  if (toolName.startsWith("mcp_")) return `Run ${toolName.replace(/^mcp_[^_]*_/, "")} on an MCP server`;
  return `Run ${toolName}`;
}

/** A stopped reply: every card still waiting is denied, so nothing runs when it is resumed. */
export function denyOpenApprovals(parts: any[]): any[] {
  return parts.map((p) => {
    if (p?.state !== "approval-requested") return p;
    if (!p.approval?.id) return { ...p, state: "output-error", errorText: "Stopped before it ran." };
    return { ...p, state: "output-denied", approval: { id: p.approval.id, approved: false, reason: STOPPED_REPLY } };
  });
}

/** Fire a follow-up after `executeCode`, or after a plan card is revised. Trailing reasoning and
 *  step-start parts don't count as an answer. `askClarification` is excluded: the user's own reply
 *  sends it. An approved plan sends its own visible message, and a waiting card never resumes. */
export function shouldAutoContinue(parts: AnyPart[] | undefined): boolean {
  const list = (parts ?? []).filter((p) => p?.type !== "reasoning" && p?.type !== "step-start");
  if (list.some((p) => (p as ToolPart).state === "approval-requested")) return false;
  const tail = list.pop();
  if (tail?.type === "tool-presentPlan") {
    const { state, output } = tail as ToolPart;
    return (state === "output-available" || state === "result") && (output as PlanDecision | undefined)?.action === "revise";
  }
  if (tail?.type !== "tool-executeCode") return false;
  const { state } = tail as ToolPart;
  return state === "output-available" || state === "result";
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
function toolKey(part: AnyPart & ToolPart, index: number): string {
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

function readFile(file: File, mode: "dataUrl" | "text"): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error || new Error("Failed to read file"));
    if (mode === "dataUrl") r.readAsDataURL(file);
    else r.readAsText(file);
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return readFile(file, "dataUrl");
}

function readAsText(file: File): Promise<string> {
  return readFile(file, "text");
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
