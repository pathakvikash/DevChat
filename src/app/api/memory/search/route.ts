import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const q = req.nextUrl.searchParams.get("q") || "";
    const trimmed = q.trim();
    if (!trimmed) {
      return NextResponse.json([]);
    }
    const memories = await prisma.memory.findMany({
      where: { userId },
      orderBy: [{ category: "asc" }, { updatedAt: "desc" }],
    });
    const lower = trimmed.toLowerCase();
    const results = memories.filter(
      (m) =>
        m.key.toLowerCase().includes(lower) ||
        m.value.toLowerCase().includes(lower) ||
        m.category.toLowerCase().includes(lower),
    );
    return NextResponse.json(results);
  } catch (e) {
    console.error("Failed to search memories:", e);
    return NextResponse.json({ error: "Failed to search memories" }, { status: 500 });
  }
}
