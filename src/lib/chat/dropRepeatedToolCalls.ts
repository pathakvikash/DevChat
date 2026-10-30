import type { UIMessageChunk } from "ai";

/**
 * A Claude Code card is answered in a new request, and its reply has to announce the tool call again so the
 * SDK can attach the next card to it. The message already holds that call, from an earlier step, and the UI
 * stream only looks for a call in the current step: the repeat would add a second, stale row above the card.
 * Dropping it lets the card and the result land on the first row.
 */
export function dropRepeatedToolCalls(continuing: { parts?: unknown } | null) {
  const known = new Set<string>();
  for (const p of Array.isArray(continuing?.parts) ? (continuing.parts as Array<{ toolCallId?: unknown }>) : []) {
    if (typeof p?.toolCallId === "string") known.add(p.toolCallId);
  }
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (chunk.type === "tool-input-available" && chunk.providerExecuted && known.has(chunk.toolCallId)) return;
      controller.enqueue(chunk);
    },
  });
}
