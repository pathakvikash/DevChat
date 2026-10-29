import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { forkConversation } from "@/lib/forkConversation";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const { messageId } = await req.json();

    if (typeof messageId !== "string" || !messageId) {
      return NextResponse.json({ error: "messageId is required" }, { status: 400 });
    }

    const result = await forkConversation(userId, id, messageId);
    if (!result.ok)
      return NextResponse.json({ error: "Chat or message not found" }, { status: 404 });

    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (error) {
    console.error("Failed to fork conversation:", error);
    return NextResponse.json({ error: "Failed to fork conversation" }, { status: 500 });
  }
}
