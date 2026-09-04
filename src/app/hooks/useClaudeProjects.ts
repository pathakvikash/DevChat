"use client";

import { useResource } from "@/app/hooks/useResource";

/** Shortens a home-directory path for display, e.g. `/Users/vikash/foo` -> `~/foo`. */
export function shortenHome(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

/** Folders Claude Code has been used in — the only places a CLI-backed model may
 *  read (chat mode) or edit (agent mode). */
export function useClaudeProjects(enabled = true) {
  const { data } = useResource<{ cwd: string }[]>(
    async () => {
      const res = await fetch("/api/claude-system/sessions?limit=1");
      if (!res.ok) throw new Error("Failed to list Claude Code projects");
      const json = await res.json();
      return ((json.projects ?? []) as { cwd: string }[]).filter((p) => p.cwd);
    },
    [],
    { enabled, onError: (e) => console.error("Failed to list Claude Code projects:", e) },
  );
  return { folders: data ?? [] };
}
