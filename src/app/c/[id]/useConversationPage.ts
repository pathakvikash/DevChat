"use client";

import { useEffect, useState } from "react";
import { fetchSettings as apiFetchSettings, saveSettings as apiSaveSettings } from "@/app/hooks/useSettingsApi";

/** Page-wide state, once per page: the web search provider (a global setting) and the seed. */
export function useConversationPage() {
  const [searchProvider, setSearchProvider] = useState<"duckduckgo" | "tavily">("duckduckgo");

  useEffect(() => {
    fetch("/api/seed", { method: "POST" }).catch(() => {});
    apiFetchSettings().then((d) => {
      if (d.searchProvider === "tavily" || d.searchProvider === "duckduckgo") {
        setSearchProvider(d.searchProvider);
      }
    }).catch(() => {});
  }, []);

  function toggleSearchProvider() {
    setSearchProvider((prev) => {
      const next = prev === "tavily" ? "duckduckgo" : "tavily";
      apiSaveSettings({ searchProvider: next }).catch(() => {});
      return next;
    });
  }

  return { searchProvider, toggleSearchProvider };
}
