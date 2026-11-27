import type { Metadata } from "next";
import Landing from "@/app/components/home/Landing";
import { siteUrl } from "@/lib/site";

// The public landing page. The middleware rewrites a signed-out "/" here, so the address a visitor and a crawler
// see is "/". Nothing in this file reads cookies or the session, so it is rendered once at build time.
// Its canonical is "/", and it is not in the sitemap.
export const metadata: Metadata = { alternates: siteUrl() ? { canonical: "/" } : undefined };

export default function Page() {
  return <Landing />;
}
