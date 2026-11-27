import { z } from "zod";
import { prisma } from "@/lib/db";
import { saveUserMessage } from "@/lib/chat/saveUserMessage";
import { safePersistAssistantMessage } from "@/lib/chat/persistAssistantMessage";
import { denyOpenApprovals } from "@/lib/utils/messageParts";

/**
 * A "local bridge" turn runs on the user's own machine and never passes through this server, so the
 * page saves the finished turn here. The body is client-supplied, so only part types that render as
 * plain rows or text are accepted: no `data-*`, no `tool-<name>` (Orrery's own tools), no files or sources.
 */

export const MAX_BODY_BYTES = 2_000_000;
export const BRIDGE_MODEL_PREFIX = "claude-code/";

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const text = z.string().max(200_000);
const textPart = z.object({ type: z.literal("text"), text });

// ChatMessages renames a "dynamic-tool" part to `tool-<toolName>`, and ToolInvocation then picks
// the card by that name (presentPlan, runAgent, createArtifact, executeCode...). Orrery's tool names
// start lowercase; a CLI's own tools (Read, Bash, WebFetch) start uppercase, or are `mcp__server__tool`.
// So only those two shapes are accepted and a bridge part can never take the place of an Orrery card.
const toolName = z.string().regex(/^(mcp__[A-Za-z0-9_-]{1,100}|[A-Z][A-Za-z0-9]{0,40})$/);

const dynamicToolPart = z.object({
  type: z.literal("dynamic-tool"),
  toolName,
  toolCallId: z.string().min(1).max(200),
  state: z.enum([
    "input-streaming",
    "input-available",
    "approval-requested",
    "approval-responded",
    "output-available",
    "output-error",
    "output-denied",
  ]),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  errorText: z.string().max(20_000).optional(),
  approval: z
    .object({ id: z.string().min(1).max(200), approved: z.boolean().optional(), reason: z.string().max(2_000).optional() })
    .optional(),
});

const assistantPart = z.discriminatedUnion("type", [
  textPart,
  z.object({ type: z.literal("reasoning"), text }),
  z.object({ type: z.literal("step-start") }),
  dynamicToolPart,
]);

const bodySchema = z
  .object({
    user: z.object({ id, text, parts: z.array(textPart).max(50) }).strict().optional(),
    assistant: z
      .object({
        id,
        parts: z.array(assistantPart).max(1_000),
        model: z.string().max(100).startsWith(BRIDGE_MODEL_PREFIX),
      })
      .strict(),
    continuing: z.boolean().optional(),
  })
  .strict();

export type BridgeSaveResult =
  | { status: 200; body: { ok: true; alreadySaved: boolean } }
  | { status: 400 | 409 | 500; body: { error: string } };

export async function saveBridgeTurn(conversationId: string, raw: unknown): Promise<BridgeSaveResult> {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { status: 400, body: { error: `Invalid bridge turn: ${issue.path.join(".") || "body"}: ${issue.message}` } };
  }
  const { user, assistant, continuing } = parsed.data;

  // Message ids are global keys: a clash with another chat's row is refused, never overwritten.
  const ids = [assistant.id, ...(user ? [user.id] : [])];
  const existing = await prisma.message.findMany({
    where: { id: { in: ids } },
    select: { id: true, conversationId: true, role: true },
  });
  const byId = new Map(existing.map((m) => [m.id, m]));
  const clash = (mid: string, role: string) => {
    const m = byId.get(mid);
    return !!m && (m.conversationId !== conversationId || m.role !== role);
  };
  if (clash(assistant.id, "assistant") || (user && clash(user.id, "user"))) {
    return { status: 409, body: { error: "A message with that id already exists" } };
  }
  // Same ids again (a retry): already saved. Only `continuing` rewrites the reply.
  if (byId.has(assistant.id) && !continuing) return { status: 200, body: { ok: true, alreadySaved: true } };

  try {
    if (user) await saveUserMessage({ conversationId, id: user.id, text: user.text, parts: user.parts });
  } catch (e) {
    console.error("[bridge-save] user message not saved:", e instanceof Error ? e.message : "error");
    return { status: 500, body: { error: "Failed to save message" } };
  }

  // Open approval cards are stored denied, so nothing can be answered (and run) from a saved turn.
  const parts = denyOpenApprovals(assistant.parts);
  const saved = await safePersistAssistantMessage(
    { steps: [] },
    {
      conversationId,
      model: assistant.model,
      messageId: assistant.id,
      updateExisting: !!continuing,
      overrideParts: parts,
    },
  );
  if (!saved) return { status: 500, body: { error: "Failed to save message" } };
  return { status: 200, body: { ok: true, alreadySaved: false } };
}
