"use client";

import { createContext, useCallback, useContext, useEffect, useRef, type RefObject } from "react";
import Lenis from "lenis";

// A ref, not state: the instance only matters when a click handler runs, so nothing re-renders when it starts.
const LenisContext = createContext<RefObject<Lenis | null> | null>(null);

/** Scrolls to a CSS selector or a y offset: Lenis when it runs, else native (smooth, or instant under reduced motion). */
export function useScrollTo() {
  const lenisRef = useContext(LenisContext);
  return useCallback(
    (target: string | number) => {
      const lenis = lenisRef?.current;
      if (lenis) return void lenis.scrollTo(target, { offset: 0 });
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth";
      if (typeof target === "number") window.scrollTo({ top: target, behavior });
      else document.querySelector(target)?.scrollIntoView({ behavior });
    },
    [lenisRef],
  );
}

/** Smooth wheel scrolling for the home page only. Off under reduced motion; destroyed on unmount. */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({
      autoRaf: true,
      duration: 1.15,
      easing: (t) => 1 - Math.pow(1 - t, 4),
      anchors: { offset: -80 },
      allowNestedScroll: true,
    });
    lenisRef.current = lenis;
    return () => {
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  return <LenisContext.Provider value={lenisRef}>{children}</LenisContext.Provider>;
}
