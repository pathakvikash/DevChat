"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, useScroll, useTransform } from "framer-motion";
import {
  Sparkles,
  MessageSquare,
  HardDrive,
  Brain,
  BookOpen,
  ArrowUp,
  ChevronDown,
} from "lucide-react";
import { useFolders } from "@/app/hooks/useFolders";
import { HomeTour } from "@/app/components/home/HomeTour";
import { SmoothScroll, useScrollTo } from "@/app/components/home/SmoothScroll";

const prompts = [
  { icon: MessageSquare, label: "Start a conversation", action: "/c/new" },
  { icon: HardDrive, label: "Browse Claude system", action: "/claude" },
  { icon: Brain, label: "View user memory", action: "/memory" },
  { icon: BookOpen, label: "Open knowledge base", action: "/kb" },
];

/** Chevron at the bottom of the hero that scrolls to the feature tour. Must render inside <SmoothScroll>. */
function ScrollHint() {
  const scrollTo = useScrollTo();
  return (
    <motion.button
      type="button"
      data-home-motion
      onClick={() => scrollTo("#tour")}
      className="focus-ring mx-auto mb-6 mt-auto flex flex-col items-center gap-1 rounded-full px-3 py-2 text-xs text-[var(--foreground)]/50 transition hover:text-[var(--foreground)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.9, duration: 0.4 }}
    >
      See what Orrery can do
      <ChevronDown size={16} className="animate-[float_2.4s_ease-in-out_infinite]" />
    </motion.button>
  );
}

export default function HomeClient() {
  const router = useRouter();
  const { hostTools, loaded, error } = useFolders();
  const showClaude = !loaded || !!error || hostTools; // hidden only once we know it is off
  const [input, setInput] = useState("");
  const heroRef = useRef<HTMLElement>(null);
  // Fade with the hero's own scroll progress, so tall screens fade as the hero leaves too.
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);
  const heroY = useTransform(scrollYProgress, [0, 0.6], [0, -40]);
  const heroPointer = useTransform(scrollYProgress, (v) => (v > 0.5 ? "none" : "auto"));

  const handleSubmit = useCallback(() => {
    const q = input.trim();
    if (!q) {
      router.push("/c/new");
      return;
    }
    router.push(`/c/new?q=${encodeURIComponent(q)}`);
  }, [input, router]);

  return (
    <SmoothScroll>
      <div className="relative overflow-x-clip bg-[var(--background)] text-[var(--foreground)]">
        <section ref={heroRef} className="relative flex min-h-[100svh] flex-col">
          {/* Center Content */}
          <motion.div
            data-home-motion
            style={{ opacity: heroOpacity, y: heroY, pointerEvents: heroPointer }}
            className="flex-1 flex flex-col items-center justify-center px-4 py-12"
          >
            {/* Hero */}
            <motion.div
              className="text-center mb-10"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            >
              <motion.div
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass border border-[var(--glass-border)] text-xs text-[var(--foreground)]/50 mb-5"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.15, duration: 0.4 }}
              >
                <Sparkles size={12} />
                AI Chat Platform
              </motion.div>

              <motion.h1
                className="text-5xl md:text-7xl font-bold tracking-tight"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.5 }}
              >
                <span className="bg-gradient-to-r from-green-400 via-yellow-400 to-green-500 bg-clip-text text-transparent">
                  Orrery
                </span>
              </motion.h1>
            </motion.div>

            {/* Input */}
            <motion.div
              className="w-full max-w-xl flex items-center gap-2"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.5 }}
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                aria-label="Message"
                placeholder="Ask anything..."
                className="flex-1 glass-input rounded-[var(--glass-radius-xl)] px-5 py-4 text-base outline-none"
              />
              <button
                onClick={handleSubmit}
                aria-label="Send"
                className="size-13 flex items-center justify-center rounded-[var(--glass-radius-xl)] bg-gradient-to-br from-green-500 to-yellow-500 hover:from-green-400 hover:to-yellow-400 text-white shadow-lg shadow-green-600/25 transition-all"
              >
                <ArrowUp size={20} />
              </button>
            </motion.div>

            {/* Feature Prompts */}
            <motion.div
              className="flex flex-wrap items-center justify-center gap-2 mt-6 max-w-xl"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.4 }}
            >
              {prompts
                .filter((p) => showClaude || p.action !== "/claude")
                .map((p) => (
                  <motion.button
                    key={p.label}
                    onClick={() => router.push(p.action)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-full glass border border-[var(--glass-border)] text-xs text-[var(--foreground)]/60 hover:text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)] transition"
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                  >
                    <p.icon size={13} />
                    {p.label}
                  </motion.button>
                ))}
            </motion.div>
          </motion.div>
          <ScrollHint />
        </section>
        <HomeTour hostTools={!!showClaude} />
      </div>
    </SmoothScroll>
  );
}
