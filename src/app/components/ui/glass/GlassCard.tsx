"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
  padding?: string;
  onClick?: () => void;
}

export default function GlassCard({
  children,
  className = "",
  hover = true,
  glow = false,
  padding = "p-6",
  onClick,
}: GlassCardProps) {
  return (
    <motion.div
      whileHover={hover ? { y: -2, boxShadow: "var(--glass-shadow-md)" } : undefined}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      onClick={onClick}
      className={`glass-card rounded-[var(--glass-radius-md)] ${padding} ${
        glow ? "shadow-[var(--glass-shadow-glow)]" : ""
      } ${onClick ? "cursor-pointer" : ""} ${className}`}
    >
      {children}
    </motion.div>
  );
}
