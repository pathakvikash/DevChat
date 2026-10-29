import { randomUUID } from "crypto";
import type { ModelMessage, UIMessageChunk } from "ai";
import { prisma } from "@/lib/db";

/** A queued message that went into the model's history at `at` (an index in that step's messages). */
export interface QueuedInjection {
  at: number;
  message: ModelMessage;
}

/** The `data-queued-message` part written into the reply where a queued message was delivered. */
export interface QueuedMarker {
  type: "data-queued-message";
  id: string;
  data: { queuedId: string; text: string };
}

/**
 * Claims every undelivered message with one token, then reads back the rows that carry it. The token
 * (not the timestamp) identifies the claim, so two claims in the same millisecond cannot read each other's rows.
 * If the read fails, the rows are put back.
 */
export async function claimQueued(conversationId: string): Promise<{ id: string; text: string }[]> {
  const token = randomUUID();
  const { count } = await prisma.queuedMessage.updateMany({
    where: { conversationId, deliveredAt: null },
    data: { deliveredAt: new Date(), claimToken: token },
  });
  if (!count) return [];
  try {
    return await prisma.queuedMessage.findMany({
      where: { conversationId, claimToken: token },
      orderBy: { seq: "asc" },
      select: { id: true, text: true },
    });
  } catch (err) {
    await prisma.queuedMessage.updateMany({
      where: { conversationId, claimToken: token },
      data: { deliveredAt: null, claimToken: null },
    });
    throw err;
  }
}

/** prepareStep's messages last for one step only, so re-insert every injected message at its index. */
export function withInjected(messages: ModelMessage[], injected: QueuedInjection[]): ModelMessage[] {
  if (!injected.length) return messages;
  const queue = [...injected].sort((a, b) => a.at - b.at);
  const out: ModelMessage[] = [];
  let next = 0;
  messages.forEach((m, i) => {
    while (next < queue.length && queue[next].at <= i) out.push(queue[next++].message);
    out.push(m);
  });
  while (next < queue.length) out.push(queue[next++].message);
  return out;
}

/** Writes pending markers just before the next step starts, so each sits between two replies. */
export function queuedMarkerTransform(pending: QueuedMarker[]) {
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (chunk.type === "start-step") {
        for (const marker of pending.splice(0)) controller.enqueue(marker as unknown as UIMessageChunk);
      }
      controller.enqueue(chunk);
    },
  });
}

/** A claimed message counts as delivered only if its marker reached the saved reply; the rest go back. */
export async function releaseUnshown(claimed: string[], parts: unknown[]): Promise<void> {
  const shown = new Set<string>();
  for (const p of parts as Array<{ type?: string; data?: { queuedId?: string } }>) {
    if (p?.type === "data-queued-message" && p.data?.queuedId) shown.add(p.data.queuedId);
  }
  const ids = claimed.filter((id) => !shown.has(id));
  if (!ids.length) return;
  await prisma.queuedMessage.updateMany({
    where: { id: { in: ids } },
    data: { deliveredAt: null, claimToken: null },
  });
}
