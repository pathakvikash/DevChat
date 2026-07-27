"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import type { ReactNode } from "react";

interface GlassPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  widthClass?: string;
  children: ReactNode;
  footer?: ReactNode;
  side?: "right" | "left";
}

const panelVariants = {
  hidden: (side: string) => ({
    x: side === "right" ? "100%" : "-100%",
    opacity: 0,
  }),
  visible: {
    x: 0,
    opacity: 1,
    transition: { type: "spring" as const, stiffness: 300, damping: 30 },
  },
  exit: (side: string) => ({
    x: side === "right" ? "100%" : "-100%",
    opacity: 0,
    transition: { type: "spring" as const, stiffness: 300, damping: 30 },
  }),
};

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

export default function GlassPanel({
  isOpen,
  onClose,
  title,
  subtitle,
  widthClass = "max-w-md",
  children,
  footer,
  side = "right",
}: GlassPanelProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <motion.div
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            custom={side}
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={`relative w-full ${widthClass} h-full glass-panel-strong flex flex-col`}
          >
            <div className="glass-surface">
              <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--glass-border)]">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--foreground)]">
                    {title}
                  </h2>
                  {subtitle && (
                    <p className="text-xs text-zinc-400 mt-0.5">{subtitle}</p>
                  )}
                </div>
                <motion.button
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={onClose}
                  className="p-1.5 rounded-lg glass-button text-zinc-400 hover:text-[var(--foreground)]"
                  aria-label="Close panel"
                >
                  <X size={18} />
                </motion.button>
              </header>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
              {children}
            </div>
            {footer && (
              <div className="border-t border-[var(--glass-border)] px-5 py-4 glass-surface">
                {footer}
              </div>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
