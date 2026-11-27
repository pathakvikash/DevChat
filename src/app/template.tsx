"use client";

import { useEffect, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

// Set after the first mount so the first page load is not animated.
let mounted = false;

/**
 * Soft fade between top-level routes. A template remounts only when its child segment changes
 * ("c" -> "settings"), so switching /c/{id} chats keeps the chat layout and its state untouched.
 */
export default function Template({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  const animate = mounted && !reduce;
  useEffect(() => {
    mounted = true;
  }, []);
  return (
    <motion.div
      className="flex min-h-0 flex-1 flex-col"
      initial={animate ? { opacity: 0.4 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
