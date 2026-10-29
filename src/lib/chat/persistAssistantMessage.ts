import { prisma } from "@/lib/db";
import { normalizeToolParts } from "@/lib/chat/normalizeToolParts";

export interface PersistAssistantMessageOptions {
  conversationId: string;
  model: string;
  onError?: (e: unknown) => void;
  systemPrompt?: string;
  // Use the client-generated message id so the persisted DB row matches the
  // id the UI uses (feedback/edit/delete keys stay consistent without a refresh).
  messageId?: string;
  /**
   * Generative-UI turns only: the already-`pipeJsonRender`-split `text`/
   * `data-spec` parts (from `createUIMessageStream`'s own `onFinish`), used
   * in place of rebuilding parts from `steps`. Without this, the persisted
   * text is the raw, pre-split model output — prose and JSONL patch lines
   * still mixed together — so reloading the page would show the JSONL as
   * plain text instead of re-rendering the UI.
   */
  overrideParts?: any[];
  /** The reply continues a saved message (a client-tool round trip): update that row, don't add a copy. */
  updateExisting?: boolean;
}

/** The reply's text in order, with each delivered queued message in its place. */
function replyText(parts: any[]): string {
  return parts
    .map((p) =>
      p.type === "text"
        ? p.text || ""
        : p.type === "data-queued-message"
          ? `\n\n${p.data?.text ?? ""}\n\n`
          : "",
    )
    .join("");
}

async function persistAssistantMessage(
  event: { steps: any[]; totalUsage?: any },
  opts: PersistAssistantMessageOptions,
): Promise<void> {
  const { conversationId, model, systemPrompt } = opts;
  const { steps, totalUsage } = event;

  // With overrideParts the stream already holds every part (tool calls and queued markers too),
  // so the steps are not added again.
  const parts: any[] = opts.overrideParts ? [...opts.overrideParts] : [];
  let finalText = opts.overrideParts ? replyText(opts.overrideParts) : "";
  let lastInputTokens = 0;

  // One part per toolCallId. A dangling call with no matching result makes
  // providers reject the whole history on reload.
  const toolPartIndex = new Map<string, number>();

  for (const step of opts.overrideParts ? [] : steps) {
    const stepText = step.text || "";
    finalText = stepText;
    if (stepText) {
      parts.push({ type: "text", text: stepText });
    }

    if (step.toolCalls && step.toolCalls.length > 0) {
      for (const tc of step.toolCalls) {
        toolPartIndex.set(tc.toolCallId, parts.length);
        parts.push({
          type: `tool-${tc.toolName}`,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.input || tc.args,
          // Upgraded below once the result lands. Client-side tools (executeCode)
          // report back from the browser, so mark it errored rather than fake output.
          state: "output-error",
          errorText: "No output was recorded for this tool call.",
        });
      }
    }

    if (step.toolResults && step.toolResults.length > 0) {
      for (const tr of step.toolResults) {
        const idx = toolPartIndex.get(tr.toolCallId);
        const resolved = {
          type: `tool-${tr.toolName}`,
          toolCallId: tr.toolCallId,
          toolName: tr.toolName,
          input: idx !== undefined ? parts[idx]?.input : undefined,
          output: tr.output,
          state: "output-available",
        };
        if (idx !== undefined) parts[idx] = resolved;
        else parts.push(resolved);
      }
    }

    if (step.usage) {
      lastInputTokens = step.usage.inputTokens ?? lastInputTokens;
    }
  }

  const totalInputTokens = totalUsage?.inputTokens ?? steps.reduce((sum, s) => sum + (s.usage?.inputTokens ?? 0), 0);
  const totalOutputTokens =
    totalUsage?.outputTokens ??
    steps.reduce((sum, s) => sum + (s.usage?.outputTokens ?? 0), 0);

  console.log(
    `[onFinish] Saving assistant message with ${parts.length} parts:`,
    parts.map((p) => p.type),
  );

  const row = {
    content: finalText,
    systemPrompt,
    // An aborted turn can leave tool calls with no result; providers reject those on reload.
    parts: JSON.stringify(normalizeToolParts(parts)),
    model,
  };
  const updated =
    opts.updateExisting && opts.messageId
      ? await prisma.message.updateMany({
          where: { id: opts.messageId, conversationId },
          data: {
            ...row,
            inputTokens: { increment: totalInputTokens },
            outputTokens: { increment: totalOutputTokens },
          },
        })
      : null;
  if (!updated?.count) {
    await prisma.message.create({
      data: {
        ...(opts.messageId ? { id: opts.messageId } : {}),
        conversationId,
        role: "assistant",
        ...row,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      },
    });
  }
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      totalTokens: {
        increment: totalInputTokens + totalOutputTokens,
      },
    },
  });
}

/** Resolves true once the message is saved; failures are reported through `onError`, not thrown. */
export function safePersistAssistantMessage(
  event: { steps: any[]; totalUsage?: any },
  opts: PersistAssistantMessageOptions,
): Promise<boolean> {
  return persistAssistantMessage(event, opts).then(
    () => true,
    (e) => {
      console.error("Failed to persist assistant message:", e);
      opts.onError?.(e);
      return false;
    },
  );
}
