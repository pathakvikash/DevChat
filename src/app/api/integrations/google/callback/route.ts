import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/workflows/http";
import { COOKIE_PATH, exchangeCode, safeReturn, siteOf, STATE_COOKIE } from "@/lib/google/sheets";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Google sends the user back here. A missing or different state (CSRF, a stale tab) is refused before anything is exchanged or stored. */
export async function GET(req: NextRequest) {
  return withUser(async (userId) => {
    const [state, returnTo] = (req.cookies.get(STATE_COOKIE)?.value ?? "").split("|");
    const given = req.nextUrl.searchParams.get("state") ?? "";
    if (!state || !given || !same(state, given)) {
      const bad = NextResponse.json({ error: "That sign-in link is not valid or has expired. Start again from DevChat." }, { status: 400 });
      bad.cookies.delete({ name: STATE_COOKIE, path: COOKIE_PATH });
      return bad;
    }
    const site = siteOf(req);
    const back = safeReturn(returnTo);
    const land = (flag: string) => {
      const res = NextResponse.redirect(`${site}${back}${back.includes("?") ? "&" : "?"}google=${flag}`);
      res.cookies.delete({ name: STATE_COOKIE, path: COOKIE_PATH });
      return res;
    };
    const code = req.nextUrl.searchParams.get("code");
    if (req.nextUrl.searchParams.get("error") || !code) return land("denied");
    try {
      await exchangeCode(userId, code, `${site}${COOKIE_PATH}/callback`);
    } catch {
      return land("failed");
    }
    return land("connected");
  });
}
