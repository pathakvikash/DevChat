import { findPage } from "@/lib/marketing/pages";
import { renderOgImage } from "@/lib/ogImage";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ section: string; slug: string }> }) {
  const { section, slug } = await params;
  return renderOgImage(findPage(section, slug)?.h1);
}
