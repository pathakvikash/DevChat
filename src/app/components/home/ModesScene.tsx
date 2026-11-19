"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import {
  motion,
  useMotionValueEvent,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { Check, ListChecks, Terminal } from "lucide-react";
import { Reveal } from "./Reveal";

const PINNED_QUERY =
  "(min-width: 768px) and (min-height: 560px) and (prefers-reduced-motion: no-preference)";

function subscribePinned(cb: () => void) {
  const mq = window.matchMedia(PINNED_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** True on wide screens with motion allowed: the only case where the scene pins. Server and first paint: false. */
function usePinned() {
  return useSyncExternalStore(
    subscribePinned,
    () => window.matchMedia(PINNED_QUERY).matches,
    () => false,
  );
}

const bubble = "glass rounded-[var(--glass-radius-xl)] px-4 py-3 text-sm";

function AskMock() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-3" aria-hidden="true">
      <div className={`${bubble} self-end bg-[var(--glass-bg-strong)] text-[var(--foreground)]/80`}>
        What does a 502 from the proxy mean?
      </div>
      <div className={`${bubble} self-start text-[var(--foreground)]/70`}>
        The proxy reached your server but got a bad reply. Check that the app is running and
        listening on the right port.
      </div>
    </div>
  );
}

function PlanMock() {
  const items = [
    "Read the failing test",
    "Find the code it calls",
    "Change one function",
    "Re-run the tests",
  ];
  return (
    <div
      className="glass-card w-full max-w-sm rounded-[var(--glass-radius-xl)] p-4"
      aria-hidden="true"
    >
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-[var(--foreground)]/60">
        <ListChecks size={14} /> Plan
      </div>
      <ol className="flex flex-col gap-2 text-sm text-[var(--foreground)]/75">
        {items.map((t, i) => (
          <li key={t} className="flex items-center gap-3">
            <span className="flex size-5 items-center justify-center rounded-full border border-[var(--glass-border-strong)] text-[10px]">
              {i + 1}
            </span>
            {t}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ApprovalMock() {
  return (
    <div
      className="glass-card w-full max-w-sm rounded-[var(--glass-radius-xl)] p-4"
      aria-hidden="true"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--foreground)]/60">
        <Terminal size={14} /> Wants to run a command
      </div>
      <code className="block rounded-lg bg-[var(--glass-bg-input)] px-3 py-2 font-mono text-xs text-[var(--foreground)]/80">
        npm test -- --run
      </code>
      <div className="mt-3 flex gap-2 text-xs">
        <span className="flex items-center gap-1 rounded-full bg-gradient-to-br from-green-500 to-yellow-500 px-3 py-1.5 font-medium text-white">
          <Check size={12} /> Allow
        </span>
        <span className="glass rounded-full px-3 py-1.5 text-[var(--foreground)]/70">Deny</span>
      </div>
    </div>
  );
}

const STEPS = [
  { title: "Ask. Get an answer.", Mock: AskMock },
  { title: "Plan. See the steps before anything runs.", Mock: PlanMock },
  { title: "Agent. It uses tools, and you approve each one.", Mock: ApprovalMock },
];

const stepInner = (title: string, Mock: () => React.JSX.Element, i: number) => (
  <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-8 px-4 md:flex-row md:justify-between md:gap-12">
    <div className="md:max-w-sm">
      <p className="mb-2 text-xs font-medium tracking-widest text-[var(--foreground)]/40">
        STEP {i + 1} OF 3
      </p>
      <h3 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h3>
    </div>
    <Mock />
  </div>
);

const heading = (
  <h2
    id="modes-heading"
    className="text-center text-xs font-medium tracking-widest text-[var(--foreground)]/40"
  >
    THREE MODES, ONE CHAT
  </h2>
);

const ranges = [
  { at: [0, 0.28, 0.34], o: [1, 1, 0], y: [0, 0, -30] },
  { at: [0.34, 0.4, 0.62, 0.68], o: [0, 1, 1, 0], y: [30, 0, 0, -30] },
  { at: [0.68, 0.74], o: [0, 1], y: [30, 0] },
];

function PinnedStep({
  p,
  at,
  out,
  yAt,
  children,
}: {
  p: MotionValue<number>;
  at: number[];
  out: number[];
  yAt: number[];
  children: React.ReactNode;
}) {
  const opacity = useTransform(p, at, out);
  const y = useTransform(p, at, yAt);
  return (
    <motion.div className="absolute inset-0 flex items-center" style={{ opacity, y }}>
      {children}
    </motion.div>
  );
}

function Pinned() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 24, mass: 0.4 });
  const [active, setActive] = useState(0);
  useMotionValueEvent(p, "change", (v) => setActive(v < 0.34 ? 0 : v < 0.68 ? 1 : 2));

  return (
    <div ref={ref} className="h-[240vh]">
      <div className="sticky top-0 flex h-[100svh] flex-col justify-center">
        <div className="absolute inset-x-0 top-24">{heading}</div>
        <div className="relative h-72 w-full">
          {STEPS.map((s, i) => (
            <PinnedStep key={s.title} p={p} at={ranges[i].at} out={ranges[i].o} yAt={ranges[i].y}>
              {stepInner(s.title, s.Mock, i)}
            </PinnedStep>
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-16 flex justify-center gap-2" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span
              key={s.title}
              className={`h-1.5 rounded-full bg-[var(--foreground)] transition-[width,opacity] ${i === active ? "w-6 opacity-70" : "w-1.5 opacity-20"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Stacked() {
  return (
    <div className="flex flex-col gap-16 py-20">
      {heading}
      {STEPS.map((s, i) => (
        <Reveal key={s.title}>{stepInner(s.title, s.Mock, i)}</Reveal>
      ))}
    </div>
  );
}

export function ModesScene() {
  return (
    <section aria-labelledby="modes-heading">{usePinned() ? <Pinned /> : <Stacked />}</section>
  );
}
