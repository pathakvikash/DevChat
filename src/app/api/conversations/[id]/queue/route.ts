import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { getConversationOrNull } from "@/lib/api/conversations";
import { agentFromJson, canDeliver, parseAgentMessagePart, AGENT_MESSAGE_PART } from "@/lib/chat/agentMessages";

type Params = { params: Promise<{ id: string }> };

// A claimed row (409) is in flight: a running step took it and its marker is not in the stream yet.
const inFlight = () => NextResponse.json({ claimed: true }, { status: 409 });
const missing = () => NextResponse.json({ error: "Queued message not found" }, { status: 404 });

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    if (!(await getConversationOrNull(id, userId))) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const queued = await prisma.queuedMessage.findMany({
      where: { conversationId: id, deliveredAt: null },
      orderBy: { seq: "asc" },
      select: { id: true, text: true, seq: true, agent: true },
    });
    return NextResponse.json({
      queued: queued.map((q) => {
        // A bad stored sender comes back without `agent` rather than failing the whole list.
        const agent = agentFromJson(q.agent);
        return { id: q.id, text: q.text, seq: q.seq, ...(agent ? { agent } : {}) };
      }),
    });
  } catch (error) {
    console.error("Failed to load the queue:", error);
    return NextResponse.json({ error: "Failed to load the queue" }, { status: 500 });
  }
}

// Idempotent: a retry of a POST whose answer was lost finds its row and succeeds.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const { id: queuedId, text, seq, agent: rawAgent } = await req.json();
    if (typeof queuedId !== "string" || !queuedId || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "id and text are required" }, { status: 400 });
    }
    // A message from another chat: its sender, checked like the part the chat request carries.
    const hasAgent = rawAgent !== undefined && rawAgent !== null;
    const agent = hasAgent ? parseAgentMessagePart({ type: AGENT_MESSAGE_PART, data: rawAgent }) : null;
    if (hasAgent && (!agent || !canDeliver(agent.hop))) {
      return NextResponse.json({ error: "agent is malformed or past the message limit" }, { status: 400 });
    }
    // A sub-agent run takes no sends, so it has no queue.
    const conv = await getConversationOrNull(id, userId);
    if (!conv || conv.kind === "subagent") {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const existing = await prisma.queuedMessage.findUnique({ where: { id: queuedId } });
    if (existing) {
      return existing.conversationId === id
        ? NextResponse.json({ id: queuedId })
        : NextResponse.json({ error: "Id already used" }, { status: 409 });
    }
    await prisma.queuedMessage.create({
      data: {
        id: queuedId,
        conversationId: id,
        text,
        seq: Number.isInteger(seq) ? seq : 0,
        agent: agent ? JSON.stringify(agent) : null,
      },
    });
    return NextResponse.json({ id: queuedId });
  } catch (error) {
    console.error("Failed to queue message:", error);
    return NextResponse.json({ error: "Failed to queue message" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const { id: queuedId, text } = await req.json();
    if (typeof queuedId !== "string" || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "id and text are required" }, { status: 400 });
    }
    if (!(await getConversationOrNull(id, userId))) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const row = await prisma.queuedMessage.findFirst({ where: { id: queuedId, conversationId: id } });
    if (!row) return missing();
    const { count } = await prisma.queuedMessage.updateMany({
      where: { id: queuedId, conversationId: id, deliveredAt: null },
      data: { text },
    });
    return count ? NextResponse.json({ ok: true }) : inFlight();
  } catch (error) {
    console.error("Failed to edit queued message:", error);
    return NextResponse.json({ error: "Failed to edit queued message" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const queuedId = req.nextUrl.searchParams.get("qid");
    if (!queuedId) {
      return NextResponse.json({ error: "qid is required" }, { status: 400 });
    }
    if (!(await getConversationOrNull(id, userId))) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const row = await prisma.queuedMessage.findFirst({ where: { id: queuedId, conversationId: id } });
    if (!row) return missing();
    const { count } = await prisma.queuedMessage.deleteMany({
      where: { id: queuedId, conversationId: id, deliveredAt: null },
    });
    return count ? NextResponse.json({ ok: true }) : inFlight();
  } catch (error) {
    console.error("Failed to remove queued message:", error);
    return NextResponse.json({ error: "Failed to remove queued message" }, { status: 500 });
  }
}
