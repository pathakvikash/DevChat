"use client";

import { motion } from "framer-motion";

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Fades and slides its children in once, when they scroll into view. `x` slides from the right instead of rising. */
export function Reveal({
  as = "div",
  delay = 0,
  x,
  y = 16,
  className,
  children,
}: {
  as?: "div" | "li";
  delay?: number;
  x?: number;
  y?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const Tag = motion[as];
  return (
    <Tag
      data-home-motion
      className={className}
      initial={x ? { opacity: 0, x } : { opacity: 0, y }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -15% 0px" }}
      transition={{ duration: 0.5, ease: EASE_OUT, delay }}
    >
      {children}
    </Tag>
  );
}
