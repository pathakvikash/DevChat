import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import HomeClient from "@/app/components/home/HomeClient";
import Landing from "@/app/components/home/Landing";

// Absolute title: the root template would add the name a second time.
export const metadata: Metadata = {
  title: { absolute: "Orrery: a multi-model AI chat workspace" },
  alternates: { canonical: "/" },
};

/** Signed-out visitors (and crawlers) get the public landing; signed-in users get the app home. */
export default async function Page() {
  // A cookie from an old AUTH_SECRET makes auth() throw: treat it as signed out (same as /login).
  let session = null;
  try {
    session = await auth();
  } catch (e) {
    if (typeof (e as { digest?: unknown })?.digest === "string") throw e;
  }
  return session?.user ? <HomeClient /> : <Landing />;
}
