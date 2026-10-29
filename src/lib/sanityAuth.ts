import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import { isSanityMode, SANITY_PROVIDER_ID, SANITY_USER } from "@/lib/sanityMode";

// Signs in the one fixed test user. It reads no input, so no identity can be supplied.
export function sanityAuthProviders(env: NodeJS.ProcessEnv = process.env) {
  if (!isSanityMode(env)) return [];
  return [
    Credentials({
      id: SANITY_PROVIDER_ID,
      name: "Sanity test user",
      credentials: {},
      authorize: async () => {
        if (!isSanityMode()) return null;
        return prisma.user.upsert({
          where: { email: SANITY_USER.email },
          update: {},
          create: SANITY_USER,
        });
      },
    }),
  ];
}
