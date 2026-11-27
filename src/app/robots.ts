import type { MetadataRoute } from "next";
import { PRIVATE_SEGMENTS, siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRIVATE_SEGMENTS.flatMap((s) => [`/${s}/`, `/${s}$`]) },
    sitemap: new URL("/sitemap.xml", siteUrl()).href,
  };
}
