import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { NextResponse } from "next/server";

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
  if (!req.auth) {
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
    "/((?!api/auth|api/providers/pair/redeem|api/providers/pair/script|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
