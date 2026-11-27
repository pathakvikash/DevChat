import type { Metadata } from "next";
import { notFound } from "next/navigation";
import MarketingPageView from "@/app/components/marketing/MarketingPage";
import { MARKETING_PAGES, findPage, pagePath } from "@/lib/marketing/pages";
import { SITE_NAME } from "@/lib/site";

// Only the pages in the data file exist; any other /x/y is a 404 (static routes such as /c/[id] still win).
export const dynamicParams = false;

type Props = { params: Promise<{ section: string; slug: string }> };

export const generateStaticParams = () => MARKETING_PAGES.map(({ section, slug }) => ({ section, slug }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { section, slug } = await params;
  const page = findPage(section, slug);
  if (!page) return {};
  const { title, description } = page;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: pagePath(page) },
    // The share image comes from opengraph-image.tsx and twitter-image.tsx next to this file.
    openGraph: { type: "website", siteName: SITE_NAME, url: pagePath(page), title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function Page({ params }: Props) {
  const { section, slug } = await params;
  const page = findPage(section, slug);
  if (!page) notFound();
  return <MarketingPageView page={page} />;
}
