import type { MetadataRoute } from "next";
import { PRIVATE_SEGMENTS, siteUrl } from "@/lib/site";

// /login is left out on purpose: it is noindex by header and meta, and a crawler must be able to fetch it to see that.
const CRAWLABLE = ["login"];

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: PRIVATE_SEGMENTS.filter((s) => !CRAWLABLE.includes(s)).flatMap((s) => [`/${s}/`, `/${s}$`]),
    },
    ...(base && { sitemap: new URL("/sitemap.xml", base).href }),
  };
}
