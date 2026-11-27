"use client";
import { Pause, Play } from "lucide-react";
import type { LiveState } from "@/app/hooks/useLiveResult";

const BTN = "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-zinc-300 glass-button focus-visible:outline-2 focus-visible:outline-blue-500";

/** "Live" badge with a pause/resume button, or the note that explains why updates stopped. */
export default function LiveBadge({ state, onToggle }: { state: LiveState; onToggle: () => void }) {
  if (state === "live")
    return (
      <div className="mb-1 flex items-center gap-2 text-xs text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
          Live
        </span>
        <button type="button" onClick={onToggle} aria-label="Pause live updates" className={BTN}>
          <Pause size={12} aria-hidden /> Pause
        </button>
      </div>
    );
  const label = state === "failed" ? "Retry" : state === "expired" ? "Paused, click to resume" : "Resume";
  return (
    <div className="mb-1 flex items-center gap-2 text-xs text-zinc-400">
      {state === "failed" && <span role="status">Live updates stopped</span>}
      <button type="button" onClick={onToggle} aria-label={state === "paused" ? "Resume live updates" : undefined} className={BTN}>
        <Play size={12} aria-hidden /> {label}
      </button>
    </div>
  );
}
