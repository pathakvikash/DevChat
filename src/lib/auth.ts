import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";

const BACKFILL_MODELS = [
  "conversation",
  "knowledgeBase",
  "memory",
  "mcpServer",
  "appSetting",
  "trace",
] as const;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      const userCount = await prisma.user.count();
      if (userCount !== 1) return;

      // First account ever created on this install: claim all pre-existing
      // unowned local data (from before login was added) for this user.
      await prisma.$transaction(
        BACKFILL_MODELS.map((model) =>
          // @ts-expect-error -- dynamic model access, all listed models share a nullable userId column
          prisma[model].updateMany({
            where: { userId: null },
            data: { userId: user.id },
          }),
        ),
      );
    },
  },
});

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError();
  return session.user.id;
}
