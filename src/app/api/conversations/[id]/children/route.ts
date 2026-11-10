import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";

const CHILD_SELECT = {
  id: true,
  title: true,
  model: true,
  kind: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { messages: true } },
} as const;

/** The main chat's side chats, newest first. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const kind = req.nextUrl.searchParams.get("kind") ?? "side";
    if (kind !== "side" && kind !== "subagent") {
      return NextResponse.json({ error: "kind must be side or subagent" }, { status: 400 });
    }

    const parent = await prisma.conversation.findFirst({ where: { id, userId }, select: { id: true } });
    if (!parent) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

    const children = await prisma.conversation.findMany({
      where: { parentId: id, userId, kind },
      orderBy: { createdAt: "desc" },
      select: CHILD_SELECT,
    });
    return NextResponse.json(children);
  } catch (error) {
    console.error("Failed to list side chats:", error);
    return NextResponse.json({ error: "Failed to list side chats" }, { status: 500 });
  }
}

type Outcome =
  | { ok: true; side: unknown; created: boolean }
  | { ok: false; status: number; error: string };

/** Starts a side chat for this main chat, or returns the newest side chat if it is still empty. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    // One serializable transaction, so two quick requests cannot both see "no empty side chat".
    const outcome = await prisma.$transaction<Outcome>(
      async (tx) => {
        const parent = await tx.conversation.findFirst({
          where: { id, userId },
          select: { kind: true, model: true },
        });
        if (!parent) return { ok: false, status: 404, error: "Conversation not found" };
        if (parent.kind !== "main") {
          return { ok: false, status: 400, error: "Only a main chat has side chats" };
        }

        const newest = await tx.conversation.findFirst({
          where: { parentId: id, userId, kind: "side" },
          orderBy: { createdAt: "desc" },
          select: CHILD_SELECT,
        });
        if (newest && newest._count.messages === 0) return { ok: true, side: newest, created: false };

        const side = await tx.conversation.create({
          data: {
            userId,
            parentId: id,
            kind: "side",
            model: typeof body.model === "string" && body.model ? body.model : parent.model,
          },
          select: CHILD_SELECT,
        });
        return { ok: true, side, created: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json(outcome.side, { status: outcome.created ? 201 : 200 });
  } catch (error) {
    console.error("Failed to create side chat:", error);
    return NextResponse.json({ error: "Failed to create side chat" }, { status: 500 });
  }
}
