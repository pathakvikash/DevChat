import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { appOrigin } from "@/lib/appOrigin";
import { withUser } from "@/lib/workflows/http";
import { COOKIE_PATH, exchangeCode, safeReturn, ScopeError, STATE_COOKIE } from "@/lib/google/sheets";

// Byte lengths: timingSafeEqual throws on buffers of different sizes, and a multibyte string can match in characters but not in bytes.
const same = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Google sends the user back here. A missing or different state (CSRF, a stale tab) is refused before anything is exchanged or stored. */
export async function GET(req: NextRequest) {
  return withUser(async (userId) => {
    const site = appOrigin(req);
    const [state, returnTo] = (req.cookies.get(STATE_COOKIE)?.value ?? "").split("|");
    const given = req.nextUrl.searchParams.get("state") ?? "";
    const goodState = !!state && !!given && same(state, given);
    // A bad state never trusts the cookie's returnTo: it lands on Settings.
    const back = goodState ? safeReturn(returnTo) : "/settings";
    const land = (flag: string) => {
      const res = NextResponse.redirect(`${site}${back}${back.includes("?") ? "&" : "?"}google=${flag}`);
      res.cookies.delete({ name: STATE_COOKIE, path: COOKIE_PATH });
      return res;
    };
    if (!goodState) return land("failed");
    const code = req.nextUrl.searchParams.get("code");
    if (req.nextUrl.searchParams.get("error") || !code) return land("denied");
    try {
      await exchangeCode(userId, code, `${site}${COOKIE_PATH}/callback`);
    } catch (e) {
      return land(e instanceof ScopeError ? "scope" : "failed");
    }
    return land("connected");
  });
}
