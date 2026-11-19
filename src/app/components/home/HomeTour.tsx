"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import {
  ArrowUp,
  ArrowRight,
  BookOpen,
  Brain,
  FolderOpen,
  GitBranch,
  LayoutTemplate,
  MessageSquarePlus,
  Network,
  Newspaper,
  Briefcase,
  SplitSquareHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { EASE_OUT, Reveal } from "./Reveal";
import { ModesScene } from "./ModesScene";
import { useScrollTo } from "./SmoothScroll";

const focus = "focus-ring";
const linkBtn =
  "glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-[var(--foreground)]/80 transition hover:bg-[var(--glass-bg-hover)] hover:text-[var(--foreground)]";

const PROVIDERS = [
  "Anthropic",
  "OpenAI",
  "Google Gemini",
  "OpenRouter",
  "NVIDIA NIM",
  "Ollama",
  "Claude Code",
  "Codex",
  "OpenCode",
];

type Card = { icon: LucideIcon; title: string; line: string; href?: string; wide?: boolean };

const CARDS: Card[] = [
  {
    icon: SplitSquareHorizontal,
    title: "Side chats",
    line: "A second chat in split view.",
    wide: true,
  },
  { icon: Users, title: "Sub-agents", line: "Hand part of a job to a helper." },
  { icon: FolderOpen, title: "Working folders", line: "Let the chat work inside a folder." },
  {
    icon: BookOpen,
    title: "Knowledge base",
    line: "Your notes, searchable in chat.",
    href: "/kb",
    wide: true,
  },
  { icon: Brain, title: "Memory", line: "What it should remember about you.", href: "/memory" },
  { icon: LayoutTemplate, title: "Generative UI", line: "Answers that render as interface." },
  { icon: Network, title: "Flow Explainer", line: "Diagrams of how a repo works." },
];

const FLOWS = [
  { icon: Newspaper, title: "News digest", line: "Gather the day's headlines and summarize them." },
  { icon: Briefcase, title: "Jobs", line: "Check job boards and keep a table of matches." },
  { icon: GitBranch, title: "Explain a repo", line: "Read a repository and draw how it works." },
];

const STATEMENT = "Your models, your folders, your memory, in one place.";

function StickyBar() {
  const { scrollY } = useScroll();
  const [shown, setShown] = useState(false);
  const scrollTo = useScrollTo();
  useMotionValueEvent(scrollY, "change", (y) => setShown(y > 0.8 * window.innerHeight));

  return (
    <motion.div
      className="glass-nav fixed inset-x-0 top-0 z-30 flex items-center justify-between px-4 py-2"
      initial={false}
      animate={{ opacity: shown ? 1 : 0, y: shown ? 0 : -8 }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
      inert={!shown}
    >
      <button
        type="button"
        className={`${focus} rounded-md px-2 py-1 text-sm font-semibold`}
        onClick={() => {
          scrollTo(0);
          document
            .querySelector<HTMLInputElement>('input[aria-label="Message"]')
            ?.focus({ preventScroll: true });
        }}
      >
        <span className="bg-gradient-to-r from-green-400 via-yellow-400 to-green-500 bg-clip-text text-transparent">
          DevChat
        </span>
      </button>
      <Link href="/c/new" className={`${focus} ${linkBtn} !py-1.5`}>
        <MessageSquarePlus size={14} /> New chat
      </Link>
    </motion.div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mx-auto w-full max-w-5xl px-4 py-24">
      <Reveal>
        <h2 id={id} className="text-center text-3xl font-bold tracking-tight md:text-5xl">
          {title}
        </h2>
      </Reveal>
      {children}
    </section>
  );
}

function Word({
  word,
  p,
  start,
  end,
}: {
  word: string;
  p: MotionValue<number>;
  start: number;
  end: number;
}) {
  const opacity = useTransform(p, [start, end], [0.25, 1]);
  return (
    <motion.span data-motion aria-hidden="true" style={{ opacity }} className="inline-block">
      {word}&nbsp;
    </motion.span>
  );
}

function Statement() {
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.45"] });
  const words = STATEMENT.split(" ");
  return (
    <section aria-labelledby="statement-h" className="mx-auto w-full max-w-4xl px-4 py-32">
      <h2 id="statement-h" className="sr-only">
        {STATEMENT}
      </h2>
      <p
        ref={ref}
        aria-hidden="true"
        className="text-center text-3xl font-bold leading-tight tracking-tight md:text-6xl"
      >
        {words.map((w, i) => (
          <Word
            key={i}
            word={w}
            p={scrollYProgress}
            start={i / words.length}
            end={(i + 1) / words.length}
          />
        ))}
      </p>
    </section>
  );
}

function FeatureCard({ card }: { card: Card }) {
  const body = (
    <motion.div
      className="glass-card h-full rounded-[var(--glass-radius-xl)] p-5"
      whileHover={{ y: -3 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
    >
      <card.icon size={20} className="mb-3 text-green-400" />
      <h3 className="font-semibold">{card.title}</h3>
      <p className="mt-1 text-sm text-[var(--foreground)]/60">{card.line}</p>
    </motion.div>
  );
  return card.href ? (
    <Link href={card.href} className={`${focus} block h-full rounded-[var(--glass-radius-xl)]`}>
      {body}
    </Link>
  ) : (
    body
  );
}

export function HomeTour() {
  const scrollTo = useScrollTo();

  return (
    <>
      <StickyBar />
      <div id="tour">
        <Section
          id="models-h"
          title={
            <>
              <span className="bg-gradient-to-r from-green-400 via-yellow-400 to-green-500 bg-clip-text text-transparent">
                One chat.
              </span>{" "}
              <span className="text-[var(--foreground)]/50">Every model.</span>
            </>
          }
        >
          <Reveal delay={0.06}>
            <p className="mx-auto mt-4 max-w-xl text-center text-[var(--foreground)]/60">
              Hosted APIs, local Ollama models, and the Claude Code, Codex and OpenCode CLIs.
            </p>
          </Reveal>
          <ul className="mt-10 flex flex-wrap justify-center gap-2">
            {PROVIDERS.map((p, i) => (
              <Reveal
                as="li"
                key={p}
                delay={0.06 * i}
                className="glass rounded-full px-4 py-2 text-sm text-[var(--foreground)]/70"
              >
                {p}
              </Reveal>
            ))}
          </ul>
        </Section>

        <ModesScene />

        <Section id="bento-h" title="More than a chat box.">
          <ul className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CARDS.map((c, i) => (
              <Reveal
                as="li"
                key={c.title}
                delay={0.06 * i}
                className={c.wide ? "lg:col-span-2" : undefined}
              >
                <FeatureCard card={c} />
              </Reveal>
            ))}
          </ul>
        </Section>

        <Section id="repeat-h" title="Put it on repeat.">
          <div className="relative mt-12">
            <motion.div
              data-motion
              aria-hidden="true"
              className="mb-6 hidden h-px origin-left bg-[var(--glass-border-strong)] md:block"
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true, margin: "0px 0px -15% 0px" }}
              transition={{ duration: 0.6, ease: EASE_OUT }}
            />
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {FLOWS.map((f, i) => (
                <Reveal as="li" key={f.title} x={40} delay={0.08 * i}>
                  <div className="glass-card h-full rounded-[var(--glass-radius-xl)] p-5">
                    <f.icon size={20} className="mb-3 text-yellow-400" />
                    <h3 className="font-semibold">{f.title}</h3>
                    <p className="mt-1 text-sm text-[var(--foreground)]/60">{f.line}</p>
                  </div>
                </Reveal>
              ))}
            </ul>
          </div>
          <Reveal delay={0.1} className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/workflows" className={`${focus} ${linkBtn}`}>
              Workflows <ArrowRight size={14} />
            </Link>
            <Link href="/tables" className={`${focus} ${linkBtn}`}>
              Tables <ArrowRight size={14} />
            </Link>
          </Reveal>
        </Section>

        <Statement />

        <section
          aria-labelledby="close-h"
          className="mx-auto w-full max-w-5xl px-4 pb-32 pt-8 text-center"
        >
          <Reveal>
            <h2 id="close-h" className="text-2xl font-semibold tracking-tight md:text-3xl">
              Ready when you are.
            </h2>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/c/new"
                className={`${focus} bg-gradient-to-br from-green-500 to-yellow-500 text-white shadow-lg shadow-green-600/25 transition hover:from-green-400 hover:to-yellow-400 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium`}
              >
                <MessageSquarePlus size={16} /> Start a chat
              </Link>
              <button
                type="button"
                onClick={() => scrollTo(0)}
                className={`${focus} ${linkBtn} !py-3`}
              >
                <ArrowUp size={14} /> Back to top
              </button>
            </div>
          </Reveal>
        </section>
      </div>
    </>
  );
}
