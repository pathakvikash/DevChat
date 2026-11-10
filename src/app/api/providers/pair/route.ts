import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { appOrigin, createPairingCode } from "@/lib/providerPair";

/** Start "connect this computer": mint a one-time code and the command to run. */
export async function POST(req: NextRequest) {
  const userId = await requireUserId();
  const code = await createPairingCode(userId);
  const origin = appOrigin(req);
  const scriptUrl = `${origin}/api/providers/pair/script`;
  return NextResponse.json({
    code,
    scriptUrl,
    command: `curl -fsSL ${scriptUrl} | node - ${code}`,
    expiresInSeconds: 600,
  });
}
