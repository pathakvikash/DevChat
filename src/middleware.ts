import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { NextResponse } from "next/server";
import { isPublicPath } from "@/lib/site";

// Edge-safe auth check: no Prisma adapter here, just JWT verification, so
// this can run in middleware without a database round trip.
const { auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
});

export default auth((req) => {
  // "/" is public: signed-in requests render the app home, signed-out ones are rewritten (not redirected) to the
  // static landing page, so the address stays "/" and no auth() call or skeleton is involved in serving it.
  if (req.nextUrl.pathname === "/") {
    return req.auth ? undefined : NextResponse.rewrite(new URL("/welcome", req.url));
  }
  // The marketing pages (src/lib/marketing/pages.ts) are public too, by exact path.
  if (!req.auth && !isPublicPath(req.nextUrl.pathname)) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  // pair/redeem and pair/script are called from a terminal with no session; the one-time
  // pairing code is their auth (see src/lib/providerPair.ts).
  matcher: [
    // Anchored: a folder is excluded with what is under it, a file only by its exact name.
    "/((?!(?:api/auth|api/providers/pair/redeem|api/providers/pair/script|login|_next/static|_next/image)(?:/|$)|(?:robots\\.txt|sitemap\\.xml|opengraph-image(?:-[a-z0-9]+)?|twitter-image(?:-[a-z0-9]+)?|icon\\.svg|apple-icon\\.png|favicon\\.ico)$).*)",
  ],
};
