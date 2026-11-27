import Image from "next/image";
import Link from "next/link";
import OrreryMark from "@/app/components/OrreryMark";
import { MARKETING_PAGES, pagePath, type MarketingPage as Page } from "@/lib/marketing/pages";
import { SITE_NAME, siteUrl } from "@/lib/site";

const cta =
  "focus-ring glass-button-primary inline-flex items-center justify-center rounded-[var(--glass-radius-md)] px-6 py-3 text-sm font-medium text-white transition";
const link = "focus-ring rounded underline underline-offset-4 hover:text-[var(--foreground)]";

/** Header and footer for the marketing pages (same look as the landing header). */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
        <Link href="/" className="focus-ring flex items-center gap-2 rounded text-sm font-semibold">
          <OrreryMark decorative />
          {SITE_NAME}
        </Link>
        <Link
          href="/login"
          className="focus-ring glass rounded-full px-4 py-1.5 text-sm text-[var(--foreground)]/80 transition hover:bg-[var(--glass-bg-hover)] hover:text-[var(--foreground)]"
        >
          Sign in
        </Link>
      </header>
      {children}
      <footer className="mx-auto w-full max-w-5xl px-4 pb-10 pt-6 text-sm text-[var(--foreground)]/60">
        <nav aria-label="Orrery pages">
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            <li>
              <Link href="/" className={link}>
                {SITE_NAME} home
              </Link>
            </li>
            {MARKETING_PAGES.map((p) => (
              <li key={p.slug}>
                <Link href={pagePath(p)} className={link}>
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </footer>
    </div>
  );
}

/** Escaped so a "</script>" inside the copy cannot end the tag. */
const ld = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

export default function MarketingPageView({ page }: { page: Page }) {
  const base = siteUrl();
  const abs = (p: string) => (base ? new URL(p, base).href : p);
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: abs("/") },
          { "@type": "ListItem", position: 2, name: page.label, item: abs(pagePath(page)) },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: page.faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };
  const related = page.related.map((path) => MARKETING_PAGES.find((p) => pagePath(p) === path)).filter((p): p is Page => !!p);

  return (
    <Shell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(jsonLd) }} />
      <main className="mx-auto w-full max-w-3xl px-4 pb-20">
        <nav aria-label="Breadcrumb" className="pt-6 text-sm text-[var(--foreground)]/60">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/" className={link}>
                {SITE_NAME}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page">{page.label}</li>
          </ol>
        </nav>

        <h1 className="mt-6 text-3xl font-bold tracking-tight md:text-5xl">{page.h1}</h1>
        <p className="mt-5 text-base text-[var(--foreground)]/70 md:text-lg">{page.intro}</p>
        <div className="mt-8">
          <Link href="/login" className={cta}>
            Sign in to {SITE_NAME}
          </Link>
        </div>

        {/* SCREENSHOT SLOT: renders when `screenshot` is set on the page in src/lib/marketing/pages.ts. */}
        {page.screenshot && (
          <Image
            src={page.screenshot.src}
            alt={page.screenshot.alt}
            width={page.screenshot.width}
            height={page.screenshot.height}
            className="mt-10 h-auto w-full rounded-[var(--glass-radius-xl)] border border-[var(--foreground)]/10"
          />
        )}

        <div className="mt-12 space-y-4">
          {page.sections.map((s) => (
            <section key={s.h2} className="glass-card rounded-[var(--glass-radius-xl)] p-6">
              <h2 className="text-xl font-semibold">{s.h2}</h2>
              <p className="mt-2 text-[var(--foreground)]/70">{s.p}</p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--foreground)]/80">
                {s.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section className="mt-12" aria-labelledby="faq">
          <h2 id="faq" className="text-2xl font-bold tracking-tight">
            Frequently asked questions
          </h2>
          <dl className="mt-4 space-y-5">
            {page.faq.map((f) => (
              <div key={f.q}>
                <dt className="font-semibold">{f.q}</dt>
                <dd className="mt-1 text-[var(--foreground)]/70">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-12" aria-labelledby="related">
          <h2 id="related" className="text-2xl font-bold tracking-tight">
            Related
          </h2>
          <ul className="mt-3 space-y-2">
            {related.map((r) => (
              <li key={r.slug}>
                <Link href={pagePath(r)} className={link}>
                  {r.h1}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-14 text-center">
          <h2 className="text-2xl font-bold tracking-tight">Try it in {SITE_NAME}</h2>
          <div className="mt-5">
            <Link href="/login" className={cta}>
              Sign in to {SITE_NAME}
            </Link>
          </div>
        </section>
      </main>
    </Shell>
  );
}
