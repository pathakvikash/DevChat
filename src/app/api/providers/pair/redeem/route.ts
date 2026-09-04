import { NextRequest, NextResponse } from "next/server";
import { redeemPairingCode } from "@/lib/providerPair";

/** Called by the connect script with no session: the one-time pairing code identifies
 *  the account, so this path is exempted from auth middleware. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.code !== "string" || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "Expected { code, items }" }, { status: 400 });
  }
  const imported = await redeemPairingCode(body.code, body.items);
  if (imported === null) {
    return NextResponse.json(
      { error: "Pairing code is invalid, already used, or expired. Click “Connect this computer” again for a new one." },
      { status: 401 },
    );
  }
  return NextResponse.json({ imported });
}
