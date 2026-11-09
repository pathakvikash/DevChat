"use client";

import SidePanel from "@/app/components/ui/SidePanel";
import { getRelativeTime } from "@/app/components/MessageActions";
import { formatDuration, formatTokens, runStatus, StatusBadge, type RunRow } from "./RunStatus";

/** The Runs side panel (8.6): newest first, each row opens that run read-only. */
export default function RunsDrawer({
  open,
  onClose,
  runs,
  currentId,
  onOpen,
}: {
  open: boolean;
  onClose: () => void;
  runs: RunRow[] | null;
  currentId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <SidePanel isOpen={open} onClose={onClose} title="Runs" subtitle="Newest first. The last 50 are kept.">
      {runs && runs.length === 0 && <p className="text-sm text-zinc-400">No runs yet. Press Run to start one.</p>}
      {!runs && <p className="text-sm text-zinc-400">Loading…</p>}
      <ul className="space-y-2">
        {(runs ?? []).map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onOpen(r.id)}
              aria-current={r.id === currentId || undefined}
              className="focus-ring glass-card w-full rounded-[var(--glass-radius-md)] px-3 py-2 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <StatusBadge status={runStatus(r.state)} />
                <span className="text-xs text-zinc-400">{getRelativeTime(r.startedAt)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] font-mono tabular-nums text-zinc-400">
                <span className="font-sans">Manual</span>
                <span>{formatDuration(r.startedAt, r.endedAt)}</span>
                <span>{formatTokens(r.inputTokens + r.outputTokens)} tokens</span>
                {r.costUsd !== null && r.costUsd > 0 && <span>${r.costUsd.toFixed(4)}</span>}
              </div>
              {r.error && <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{r.error}</p>}
            </button>
          </li>
        ))}
      </ul>
    </SidePanel>
  );
}
