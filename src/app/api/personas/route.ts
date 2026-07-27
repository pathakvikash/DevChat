import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  try {
    const personas = await prisma.persona.findMany({
      orderBy: [
        { isBuiltIn: "desc" }, // Built-in personas first
        { createdAt: "desc" },
      ],
    });

    return NextResponse.json(personas);
  } catch (error) {
    console.error("Failed to fetch personas:", error);
    return NextResponse.json({ error: "Failed to fetch personas" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, description, systemPrompt } = await req.json();

    if (!name || !description || !systemPrompt) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (name.length > 100) {
      return NextResponse.json(
        { error: "Name must be 100 characters or fewer" },
        { status: 400 },
      );
    }
    if (description.length > 500) {
      return NextResponse.json(
        { error: "Description must be 500 characters or fewer" },
        { status: 400 },
      );
    }
    if (systemPrompt.length > 4000) {
      return NextResponse.json(
        { error: "System prompt must be 4000 characters or fewer" },
        { status: 400 },
      );
    }

    const persona = await prisma.persona.create({
      data: {
        name,
        description,
        systemPrompt,
        isBuiltIn: false,
      },
    });

    return NextResponse.json(persona, { status: 201 });
  } catch (error) {
    console.error("Failed to create persona:", error);
    return NextResponse.json({ error: "Failed to create persona" }, { status: 500 });
  }
}
