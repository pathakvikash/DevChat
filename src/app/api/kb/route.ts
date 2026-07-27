import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  try {
    const knowledgeBases = await prisma.knowledgeBase.findMany({
      include: {
        _count: { select: { documents: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(knowledgeBases);
  } catch (error) {
    console.error("Failed to fetch knowledge bases:", error);
    return NextResponse.json({ error: "Failed to fetch knowledge bases" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, description } = await req.json();

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const kb = await prisma.knowledgeBase.create({
      data: { name, description },
    });

    return NextResponse.json(kb, { status: 201 });
  } catch (error) {
    console.error("Failed to create knowledge base:", error);
    return NextResponse.json({ error: "Failed to create knowledge base" }, { status: 500 });
  }
}
