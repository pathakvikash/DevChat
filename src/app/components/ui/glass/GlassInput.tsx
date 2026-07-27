"use client";

import { motion } from "framer-motion";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

interface GlassInputProps extends InputHTMLAttributes<HTMLInputElement> {
  multiline?: false;
}

interface GlassTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  multiline: true;
}

type Props = GlassInputProps | GlassTextareaProps;

export default function GlassInput(props: Props) {
  const { multiline, className = "", ...rest } = props as any;

  const baseClass = `glass-input w-full rounded-[var(--glass-radius-md)] px-4 py-2.5 text-sm text-[var(--foreground)] placeholder:text-zinc-500 outline-none transition-all duration-200 ${className}`;

  if (multiline) {
    return (
      <motion.textarea
        whileFocus={{ boxShadow: "var(--glass-shadow-glow)" }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        className={baseClass}
        {...(rest as any)}
      />
    );
  }

  return (
    <motion.input
      whileFocus={{ boxShadow: "var(--glass-shadow-glow)" }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={baseClass}
      {...(rest as any)}
    />
  );
}
