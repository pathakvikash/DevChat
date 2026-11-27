import type { MetadataRoute } from "next";
import { PUBLIC_PATHS, siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  if (!base) return []; // no known host: list nothing rather than another host's URLs
  return PUBLIC_PATHS.map((p) => ({ url: new URL(p, base).href, changeFrequency: "monthly", priority: 1 }));
}
