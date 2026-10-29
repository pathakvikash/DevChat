"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { MotionConfig } from "framer-motion";

type Theme = "dark" | "light";

const STORAGE_KEY = "vas:theme";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
}>({
  theme: "dark",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (saved === "light" || saved === "dark") {
      setThemeState(saved);
    }
    setMounted(true);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // framer-motion ignores prefers-reduced-motion unless told to follow it.
  return (
    <MotionConfig reducedMotion="user">
      {mounted ? (
        <ThemeContext.Provider value={{ theme, setTheme }}>
          {children}
        </ThemeContext.Provider>
      ) : (
        children
      )}
    </MotionConfig>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
