import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";

async function assertConversationOwner(id: string, userId: string): Promise<boolean> {
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: { userId: true },
  });
  return !!conversation && conversation.userId === userId;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    if (!(await assertConversationOwner(id, userId))) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const todos = await prisma.todo.findMany({
      where: { conversationId: id },
      orderBy: [{ status: "asc" }, { order: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ todos });
  } catch (error) {
    console.error("Failed to fetch todos:", error);
    return NextResponse.json({ error: "Failed to fetch todos" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const body = await req.json();
    const { todoId, status, title, priority, order } = body;

    if (!todoId) {
      return NextResponse.json({ error: "todoId is required" }, { status: 400 });
    }
    if (!(await assertConversationOwner(id, userId))) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const existing = await prisma.todo.findFirst({
      where: { id: todoId, conversationId: id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });
    }

    const todo = await prisma.todo.update({
      where: { id: todoId },
      data: {
        ...(status !== undefined && { status }),
        ...(title !== undefined && { title }),
        ...(priority !== undefined && { priority }),
        ...(order !== undefined && { order }),
      },
    });

    return NextResponse.json({ todo });
  } catch (error) {
    console.error("Failed to update todo:", error);
    return NextResponse.json({ error: "Failed to update todo" }, { status: 500 });
  }
}
