import {
  shouldAutoCompress,
  compressConversation,
  saveCompressedSummary,
  DEFAULT_COMPACTION_MODEL,
} from "@/lib/compression";

// A hung local Ollama must not hold the stream open: it stays open until this resolves.
export const AUTO_COMPRESS_TIMEOUT_MS = 20_000;

interface StepToolInfo {
  text?: string;
  toolCalls?: { toolCallId: string }[];
  toolResults?: { toolCallId: string }[];
  // `toolResults` leaves out failed calls; those show up here as `tool-error` parts.
  content?: { type: string; toolCallId?: string }[];
}

// A tool call with neither result nor error is a client-side tool (executeCode,
// askClarification) still pending: its call must stay in history for the continuation.
function hasPendingToolCall(steps: StepToolInfo[]): boolean {
  const last = steps[steps.length - 1];
  const done = new Set([
    ...(last?.toolResults ?? []).map((r) => r.toolCallId),
    ...(last?.content ?? []).filter((p) => p.type === "tool-error").map((p) => p.toolCallId),
  ]);
  return (last?.toolCalls ?? []).some((c) => !done.has(c.toolCallId));
}

/** Only a turn that finished cleanly is compressed: not stopped, not errored (no finished
 *  step), and with no client-side tool call still waiting for its result. */
export function canAutoCompress(
  event: { steps: StepToolInfo[]; finishReason?: string },
  isAborted: boolean,
): boolean {
  return (
    !isAborted &&
    event.finishReason !== "error" &&
    event.steps.length > 0 &&
    !hasPendingToolCall(event.steps)
  );
}

/** Summarizes the chat when it nears the context limit. The reply is already saved, so a
 *  failed or timed-out compression only skips the summary. */
export async function autoCompress(
  conversationId: string,
  threshold: number,
  onCompressing?: () => void,
): Promise<void> {
  try {
    const needsCompression = await shouldAutoCompress(conversationId, threshold);
    console.log(
      `[Auto-compress] Conversation ${conversationId}: needsCompression=${needsCompression}, model=${DEFAULT_COMPACTION_MODEL}`,
    );
    if (!needsCompression) return;
    onCompressing?.();
    const result = await compressConversation(
      conversationId,
      DEFAULT_COMPACTION_MODEL,
      AUTO_COMPRESS_TIMEOUT_MS,
    );
    if (!result) return;
    await saveCompressedSummary(
      conversationId,
      result.summary,
      {
        beforeTokens: result.beforeTokens,
        afterTokens: result.afterTokens,
        beforeMessages: result.beforeMessages,
      },
      result.cutAt,
    );
    console.log(
      `[Auto-compress] Summary saved (${result.beforeTokens} -> ${result.afterTokens} tokens, -${result.reductionPercent}%)`,
    );
  } catch (e) {
    console.error("[Auto-compress] failed:", e);
  }
}
