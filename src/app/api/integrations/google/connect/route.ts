import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { appOrigin } from "@/lib/appOrigin";
import { withUser } from "@/lib/workflows/http";
import { authorizeUrl, COOKIE_PATH, googleConfigured, safeReturn, STATE_COOKIE } from "@/lib/google/sheets";
import { isSanityMode } from "@/lib/sanityMode";

/** Starts Google sign-in for Sheets (scope drive.file only). `?returnTo=/tables/x` is where the user lands afterwards. */
export async function GET(req: NextRequest) {
  return withUser(async () => {
    const site = appOrigin(req);
    const returnTo = safeReturn(req.nextUrl.searchParams.get("returnTo"));
    if (!googleConfigured()) return NextResponse.redirect(`${site}${returnTo}${returnTo.includes("?") ? "&" : "?"}google=not-configured`);
    const state = randomBytes(24).toString("base64url");
    const redirectUri = `${site}${COOKIE_PATH}/callback`;
    // The sanity suite has no Google: its consent screen is the callback itself, with a made-up code.
    const to = isSanityMode() ? `${redirectUri}?code=sanity-code&state=${state}` : authorizeUrl(redirectUri, state);
    const res = NextResponse.redirect(to);
    res.cookies.set(STATE_COOKIE, `${state}|${returnTo}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: COOKIE_PATH });
    return res;
  });
}
