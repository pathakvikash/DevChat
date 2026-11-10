"use client";

import { useCallback, useEffect, useState } from "react";
import type { CardRun, RunState, WorkflowGraph } from "@/lib/workflows/graph";

export interface RunView {
  id: string;
  workflowId: string;
  state: RunState;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  inputTokens: number;
  outputTokens: number;
  graph: WorkflowGraph;
  nodes: Record<string, CardRun>;
}

const WAITING_POLL_MS = 10_000;

/**
 * One run's state, polled every 1.5 s while it runs (5 s in a hidden tab) and every 10 s while it waits for the user.
 * Polling stops when the run ends; `restart` starts it again (after Resume). The run itself lives on the server, so closing the tab loses nothing.
 */
export function useWorkflowRun(runId: string | null) {
  // Tagged with its id, so a run from before a switch is never shown for the new one.
  const [state, setState] = useState<{ id: string; run: RunView | null } | null>(null);
  const [poke, setPoke] = useState(0);
  const restart = useCallback(() => setPoke((n) => n + 1), []);

  useEffect(() => {
    if (!runId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      try {
        const res = await fetch(`/api/workflow-runs/${runId}`);
        if (stop) return;
        if (res.ok) {
          const next = (await res.json()) as RunView;
          setState({ id: runId!, run: next });
          if (next.state !== "running" && next.state !== "waiting") return;
          // A waiting run is checked slowly: another tab may have continued or cancelled it, and a stale banner must not offer a Cancel for a run that moved on.
          if (next.state === "waiting") {
            if (!stop) timer = setTimeout(tick, WAITING_POLL_MS);
            return;
          }
        } else if (res.status === 404) {
          setState({ id: runId!, run: null });
          return;
        }
      } catch {
        // a network blip: try again on the next tick
      }
      if (!stop) timer = setTimeout(tick, document.visibilityState === "hidden" ? 5000 : 1500);
    }
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [runId, poke]);

  const run = runId && state?.id === runId ? state.run : null;
  return { run, restart };
}

export async function fetchNodeRun(runId: string, nodeId: string): Promise<CardRun | null> {
  const res = await fetch(`/api/workflow-runs/${runId}?node=${encodeURIComponent(nodeId)}`);
  return res.ok ? ((await res.json()) as CardRun) : null;
}
