import { specElementTypes } from "@/lib/chat/normalizeToolParts";
import { partsOf } from "@/lib/chat/renderTranscript";
import { isToolPart } from "@/lib/utils/messageParts";

interface ExportedMessage {
  role: string;
  content: string;
  parts: string | null;
  createdAt: Date;
}

interface ExportedConversation {
  title: string;
  model: string;
  persona?: string | null;
  createdAt: Date;
  compressedAt?: Date | null;
  messages: ExportedMessage[];
}

type ArtifactRef = { id: string; title: string; type: string };
type ArtifactsById = Map<string, ArtifactRef>;

/** "Artifact created: <id> (v1) — "Title"", also "Data artifact created: …" from executeCode. */
const ARTIFACT_RE = /^(?:Data )?[Aa]rtifact (?:created|updated): (\S+)(?: \(v\d+\))? — "([^"]*)"/;
const INPUT_MAX = 200;

function oneLine(value: unknown): string {
  const json = JSON.stringify(value ?? {});
  return json.length > INPUT_MAX ? `${json.slice(0, INPUT_MAX)}…` : json;
}

function toolLine(part: any, artifacts: ArtifactsById): string {
  const name = String(part.type).slice(5);
  const made = ARTIFACT_RE.exec(typeof part.output === "string" ? part.output : "");
  if (made) {
    const known = artifacts.get(made[1]);
    return `[artifact] "${known?.title ?? made[2]}" (${known?.type ?? part.input?.type ?? "artifact"})`;
  }
  const ok = part.output !== undefined && !part.errorText && part.state !== "output-error";
  return `[tool] ${name} ${oneLine(part.input)} → ${ok ? "ok" : "error"}`;
}

/** One `[chart]` / `[table]` line per such component the model rendered. */
function specLines(parts: any[]): string[] {
  return specElementTypes(parts).flatMap((type) => (type === "Chart" || type === "Table" ? [`[${type.toLowerCase()}]`] : []));
}

function messageBody(m: ExportedMessage, artifacts: ArtifactsById): string {
  const parts = partsOf(m);
  if (!parts) return m.content;
  const lines = parts.flatMap((p) => {
    if (p?.type === "text") return p.text ? [p.text as string] : [];
    return isToolPart(p) ? [toolLine(p, artifacts)] : [];
  });
  return [...lines, ...specLines(parts)].join("\n\n");
}

/** Markdown for a saved chat: every message, including ones folded into a summary. */
export function conversationToMarkdown(conversation: ExportedConversation, artifacts: ArtifactRef[]): string {
  const { messages, compressedAt: summaryAt } = conversation;
  const artifactsById: ArtifactsById = new Map(artifacts.map((a) => [a.id, a]));
  const summaryLine = summaryAt
    ? `_Chat compressed here (${summaryAt.toISOString()}); the model saw a summary of the messages above._`
    : "";
  // The summary line goes before the first message it did not cover, or last if there is none.
  const firstAfter = summaryAt && messages.find((m) => m.createdAt >= summaryAt);
  const out = [
    `# ${conversation.title}`,
    [
      `**Model:** ${conversation.model}`,
      conversation.persona ? `**Persona:** ${conversation.persona}` : "",
      `**Created:** ${conversation.createdAt.toISOString()}`,
    ]
      .filter(Boolean)
      .join("\n"),
    "---",
  ];
  for (const m of messages) {
    if (m === firstAfter) out.push(summaryLine);
    const body = messageBody(m, artifactsById);
    if (body) out.push(`### ${m.role.charAt(0).toUpperCase()}${m.role.slice(1)}\n\n${body}`);
  }
  if (summaryAt && !firstAfter) out.push(summaryLine);
  return `${out.join("\n\n")}\n`;
}
