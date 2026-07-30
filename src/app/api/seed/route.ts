import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { seedBuiltInPersonas } from "@/lib/builtInPersonas";

export async function POST() {
  try {
    const seededCount = await seedBuiltInPersonas(prisma);

    return NextResponse.json({
      success: true,
      seededCount,
      message: `Seeded ${seededCount} personas`,
    });
  } catch (error) {
    console.error("Seed failed:", error);
    return NextResponse.json({ error: "Seed failed" }, { status: 500 });
  }
}
