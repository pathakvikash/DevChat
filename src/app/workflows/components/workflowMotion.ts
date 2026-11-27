import type { DisplayStatus } from "./RunStatus";
import type { RunState } from "@/lib/workflows/graph";

/** CSS class for a card's motion. Only while a run is active; `prev` is the status last rendered (undefined on first render, so a loaded page never animates). */
export function cardMotion(status: DisplayStatus, prev: DisplayStatus | undefined, runState?: RunState): string {
  if (runState !== "running" && runState !== "waiting") return "";
  if (status === "running") return "wf-run";
  if (status === "waiting") return "wf-wait";
  if (!prev || prev === status) return "";
  if (status === "done") return "wf-pop";
  if (status === "failed") return "wf-shake";
  return "";
}
