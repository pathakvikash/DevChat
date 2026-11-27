"use client";

import { useReducedMotion } from "framer-motion";

/** Shared motion constants: UI transitions stay 120-200ms, ease-out, opacity/transform only. */
export const DUR = { fast: 0.12, base: 0.16, slow: 0.2 } as const;
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const SPRING = { type: "spring", stiffness: 500, damping: 30 } as const;
export const FADE = { duration: DUR.base, ease: EASE_OUT } as const;

/** False when the user asked for reduced motion: show the final state with no movement. */
export function useMotionOK(): boolean {
  return !useReducedMotion();
}
