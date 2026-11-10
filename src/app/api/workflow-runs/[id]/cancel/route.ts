import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/workflows/http";
import { cancelRun } from "@/lib/workflows/runner";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    if (!(await cancelRun(userId, id))) return NextResponse.json({ error: "That run is not running" }, { status: 409 });
    return NextResponse.json({ ok: true });
  });
}
