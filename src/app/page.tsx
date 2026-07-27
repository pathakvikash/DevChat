"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Sparkles, MessageSquare, HardDrive, Brain, BookOpen, ArrowUp } from "lucide-react";

const prompts = [
  { icon: MessageSquare, label: "Start a conversation", action: "/c/new" },
  { icon: HardDrive, label: "Browse Claude system", action: "/claude" },
  { icon: Brain, label: "View user memory", action: "/memory" },
  { icon: BookOpen, label: "Open knowledge base", action: "/kb" },
];

export default function HomePage() {
  const router = useRouter();
  const [input, setInput] = useState("");

  const handleSubmit = useCallback(() => {
    const q = input.trim();
    if (!q) {
      router.push("/c/new");
      return;
    }
    router.push(`/c/new?q=${encodeURIComponent(q)}`);
  }, [input, router]);

  return (
    <div className="relative min-h-screen bg-[var(--background)] text-[var(--foreground)] flex flex-col">
      {/* Center Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
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
              DevChat
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
            placeholder="Ask anything..."
            className="flex-1 glass-input rounded-[var(--glass-radius-xl)] px-5 py-4 text-base outline-none"
          />
          <button
            onClick={handleSubmit}
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
          {prompts.map((p) => (
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
      </div>
    </div>
  );
}
