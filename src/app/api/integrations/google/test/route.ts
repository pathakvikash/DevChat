import { NextRequest, NextResponse } from "next/server";
import { isSanityMode } from "@/lib/sanityMode";
import { fakeState } from "@/lib/google/fake";

// Sanity suite only (404 anywhere else): lets e2e age the fake Google's tokens, make refresh fail, and read the sheets it holds.
export async function POST(req: NextRequest) {
  if (!isSanityMode()) return new NextResponse(null, { status: 404 });
  const st = fakeState();
  const body = (await req.json().catch(() => ({}))) as { expireAccess?: boolean; failRefresh?: boolean; reset?: boolean };
  if (body.reset) {
    st.sheets.clear();
    st.failRefresh = false;
  }
  if (body.expireAccess) st.live.clear();
  if (typeof body.failRefresh === "boolean") st.failRefresh = body.failRefresh;
  return NextResponse.json({ sheets: [...st.sheets].map(([id, s]) => ({ id, ...s })) });
}
