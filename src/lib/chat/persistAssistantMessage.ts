import { prisma } from "@/lib/db";
import {
  shouldAutoCompress,
  compressConversation,
  saveCompressedSummary,
  DEFAULT_COMPACTION_MODEL,
} from "@/lib/compression";

export interface PersistAssistantMessageOptions {
  conversationId: string;
  model: string;
  autoCompressThreshold?: number;
  onError?: (e: unknown) => void;
  systemPrompt?: string;
  // Use the client-generated message id so the persisted DB row matches the
  // id the UI uses (feedback/edit/delete keys stay consistent without a refresh).
  messageId?: string;
}

async function persistAssistantMessage(
  event: { steps: any[]; totalUsage?: any },
  opts: PersistAssistantMessageOptions,
): Promise<void> {
  const { conversationId, model, autoCompressThreshold, systemPrompt } = opts;
  const { steps, totalUsage } = event;

  const parts: any[] = [];
  let finalText = "";
  let lastInputTokens = 0;

  // One part per toolCallId. A dangling call with no matching result makes
  // providers reject the whole history on reload.
  const toolPartIndex = new Map<string, number>();

  for (const step of steps) {
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

  await prisma.message.create({
    data: {
      ...(opts.messageId ? { id: opts.messageId } : {}),
      conversationId,
      role: "assistant",
      content: finalText,
      systemPrompt,
      parts: JSON.stringify(parts),
      model,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    },
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      totalTokens: {
        increment: totalInputTokens + totalOutputTokens,
      },
    },
  });

  const threshold = autoCompressThreshold ?? 85;
  const needsCompression = await shouldAutoCompress(conversationId, threshold);
  console.log(
    `[Auto-compress] Conversation ${conversationId}: needsCompression=${needsCompression}, model=${DEFAULT_COMPACTION_MODEL}`,
  );
  if (needsCompression) {
    const result = await compressConversation(
      conversationId,
      DEFAULT_COMPACTION_MODEL,
    );
    if (result) {
      await saveCompressedSummary(conversationId, result.summary, {
        beforeTokens: result.beforeTokens,
        afterTokens: result.afterTokens,
        beforeMessages: result.beforeMessages,
      });
      console.log(
        `[Auto-compress] Summary saved (${result.beforeTokens} -> ${result.afterTokens} tokens, -${result.reductionPercent}%)`,
      );
    }
  }
}

export function safePersistAssistantMessage(
  event: { steps: any[]; totalUsage?: any },
  opts: PersistAssistantMessageOptions,
): void {
  persistAssistantMessage(event, opts).catch((e) => {
    console.error("Failed to persist assistant message:", e);
    opts.onError?.(e);
  });
}
