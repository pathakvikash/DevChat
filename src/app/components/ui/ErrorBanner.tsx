"use client";

import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

interface ErrorBannerProps {
  children: ReactNode;
  className?: string;
  iconSize?: number;
}

export default function ErrorBanner({
  children,
  className = "",
  iconSize = 16,
}: ErrorBannerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring" as const, stiffness: 300, damping: 20 }}
      className={`flex items-center gap-2 p-3 rounded-[var(--glass-radius-md)] border border-red-900/60 bg-red-950/40 backdrop-blur-[var(--glass-blur-sm)] text-sm text-red-200 ${className}`}
    >
      <AlertTriangle size={iconSize} />
      <div className="flex-1">{children}</div>
    </motion.div>
  );
}
