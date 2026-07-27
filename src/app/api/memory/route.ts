import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  try {
    const memories = await prisma.memory.findMany({
      orderBy: [{ category: "asc" }, { updatedAt: "desc" }],
    });
    return NextResponse.json(memories);
  } catch (e) {
    console.error("Failed to list memories:", e);
    return NextResponse.json({ error: "Failed to list memories" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { key, value, category, pinned } = await req.json();
    if (!key || typeof key !== "string" || !value || typeof value !== "string") {
      return NextResponse.json(
        { error: "key and value are required strings" },
        { status: 400 }
      );
    }
    const cleanKey = key.trim().slice(0, 80);
    const cleanCategory = (category || "general").trim().slice(0, 40);
    const cleanValue = value.trim().slice(0, 2000);

    const memory = await prisma.memory.upsert({
      where: { key: cleanKey },
      create: { key: cleanKey, value: cleanValue, category: cleanCategory, pinned: pinned === true },
      update: { value: cleanValue, category: cleanCategory, pinned: pinned === true },
    });
    return NextResponse.json(memory);
  } catch (e) {
    console.error("Failed to upsert memory:", e);
    return NextResponse.json({ error: "Failed to save memory" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const key = req.nextUrl.searchParams.get("key");
    const all = req.nextUrl.searchParams.get("all");
    if (all === "1") {
      await prisma.memory.deleteMany({});
      return NextResponse.json({ success: true, deleted: "all" });
    }
    if (!key) {
      return NextResponse.json({ error: "key query param required" }, { status: 400 });
    }
    await prisma.memory.delete({ where: { key } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e?.code === "P2025") {
      // Not found — treat as success (idempotent forget).
      return NextResponse.json({ success: true, notFound: true });
    }
    console.error("Failed to delete memory:", e);
    return NextResponse.json({ error: "Failed to delete memory" }, { status: 500 });
  }
}
