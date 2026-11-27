import Link from "next/link";
import OrreryMark from "@/app/components/OrreryMark";
import { MARKETING_PAGES, pagePath } from "@/lib/marketing/pages";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";

const FEATURES = [
  {
    title: "Many providers, one chat",
    text: "Talk to Anthropic, OpenAI, Google Gemini, OpenRouter and NVIDIA NIM, or run local models through Ollama. Switch model mid-conversation.",
  },
  {
    title: "Ask and Agent modes",
    text: "Ask for a quick answer, or hand the job to Agent mode, where the model plans, uses tools and works through the steps.",
  },
  {
    title: "Workflows",
    text: "Turn a repeatable job into a workflow, such as a daily news digest, and run it on a schedule or on demand.",
  },
  {
    title: "Artifacts",
    text: "Pages, code and documents the model writes open beside the chat, ready to preview, edit and export.",
  },
  {
    title: "Charts and 3D in the answer",
    text: "Generative UI renders answers as interactive charts and 3D scenes instead of a wall of text.",
  },
  {
    title: "Connected apps",
    text: "Connect your tools through MCP and apps such as Google Sheets so chats and workflows can act on your own data.",
  },
];

const cta =
  "focus-ring glass-button-primary inline-flex items-center justify-center rounded-[var(--glass-radius-md)] px-6 py-3 text-sm font-medium text-white transition";

export default function Landing() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: siteUrl().href,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <OrreryMark decorative />
          {SITE_NAME}
        </span>
        <Link
          href="/login"
          className="focus-ring glass rounded-full px-4 py-1.5 text-sm text-[var(--foreground)]/80 transition hover:bg-[var(--glass-bg-hover)] hover:text-[var(--foreground)]"
        >
          Sign in
        </Link>
      </header>

      <main>
        <section className="mx-auto w-full max-w-3xl px-4 pb-16 pt-16 text-center md:pt-24">
          <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
            One AI chat workspace for every model
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-[var(--foreground)]/70 md:text-lg">
            {SITE_NAME} brings cloud and local models, agents, workflows and your connected apps
            into a single place to think, build and get work done.
          </p>
          <div className="mt-8">
            <Link href="/login" className={cta}>
              Sign in to {SITE_NAME}
            </Link>
          </div>
        </section>

        <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 pb-20 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <section key={f.title} className="glass-card rounded-[var(--glass-radius-xl)] p-6">
              <h2 className="text-lg font-semibold">{f.title}</h2>
              <p className="mt-2 text-sm text-[var(--foreground)]/70">{f.text}</p>
            </section>
          ))}
        </div>

        <section aria-labelledby="learn-more" className="mx-auto w-full max-w-5xl px-4 pb-20">
          <h2 id="learn-more" className="text-center text-2xl font-bold tracking-tight md:text-3xl">
            Learn what {SITE_NAME} can do
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MARKETING_PAGES.map((p) => (
              <li key={p.slug} className="glass-card rounded-[var(--glass-radius-xl)] p-5">
                <Link href={pagePath(p)} className="focus-ring rounded font-semibold underline underline-offset-4">
                  {p.h1}
                </Link>
                <p className="mt-2 text-sm text-[var(--foreground)]/70">{p.blurb}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto w-full max-w-3xl px-4 pb-24 text-center">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Ready to try it?</h2>
          <p className="mt-3 text-[var(--foreground)]/70">Sign in with your Google account and start your first chat.</p>
          <div className="mt-6">
            <Link href="/login" className={cta}>
              Sign in with Google
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
