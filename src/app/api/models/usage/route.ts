import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const conversations = await prisma.conversation.findMany({
      select: { model: true },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });

    const usage: Record<string, number> = {};
    for (const conv of conversations) {
      usage[conv.model] = (usage[conv.model] || 0) + 1;
    }

    return NextResponse.json({ usage });
  } catch (error) {
    console.error("Failed to fetch model usage:", error);
    return NextResponse.json({ error: "Failed to fetch model usage" }, { status: 500 });
  }
}
