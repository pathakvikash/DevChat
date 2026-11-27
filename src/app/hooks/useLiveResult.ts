"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OrreryResult, RefreshSpec } from "@/lib/apps/types";
import { clampEvery, liveDelay, liveExpired, liveFailed } from "@/lib/generativeUi/livePoll";

export type LiveState = "live" | "paused" | "expired" | "failed";

/**
 * Re-runs a result's refresh through POST /api/apps/refresh-result (the server reads tool and args from the stored
 * artifact, so only the artifact id is sent). Polls only while `ref`'s element is in view and the tab is visible, stops
 * after 15 minutes or 5 consecutive failures, and backs off on errors. `data` is the latest refreshed result, or null.
 */
export function useLiveResult<T extends OrreryResult["type"]>(artifactId: string | null | undefined, refresh: RefreshSpec | undefined, type: T) {
  const enabled = !!artifactId && !!refresh;
  const every = clampEvery(refresh?.everyMs);
  const [data, setData] = useState<Extract<OrreryResult, { type: T }> | null>(null);
  const [el, setEl] = useState<Element | null>(null);
  const [inView, setInView] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const [expired, setExpired] = useState(false);
  const [failed, setFailed] = useState(false);
  const [epoch, setEpoch] = useState(0); // bumped on resume: starts a new 15 minute window
  const started = useRef({ epoch: -1, at: 0 }); // only touched inside effects

  useEffect(() => {
    if (!enabled || !el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, el]);

  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState === "visible");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const active = enabled && inView && tabVisible && !paused && !expired && !failed;
  useEffect(() => {
    if (!active) return;
    if (started.current.epoch !== epoch) started.current = { epoch, at: Date.now() };
    let stop = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ac: AbortController | undefined;
    const tick = async () => {
      if (liveExpired(started.current.at, Date.now())) return setExpired(true);
      ac = new AbortController();
      let delay = every;
      try {
        const res = await fetch("/api/apps/refresh-result", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artifactId }),
          signal: ac.signal,
        });
        if (res.status === 429) delay = Math.max(every, (Number(res.headers.get("Retry-After")) || 0) * 1000);
        else {
          if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
          const next = await res.json();
          if (next?.type !== type) throw new Error("Unexpected result type");
          if (stop) return;
          failures = 0;
          setData(next);
        }
      } catch (e) {
        if (stop || (e as Error).name === "AbortError") return;
        if (liveFailed(++failures)) return setFailed(true);
        delay = liveDelay(every, failures);
      }
      if (!stop) timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, every);
    return () => {
      stop = true;
      clearTimeout(timer);
      ac?.abort();
    };
  }, [active, every, artifactId, type, epoch]);

  const state: LiveState = failed ? "failed" : expired ? "expired" : paused ? "paused" : "live";
  /** Pause when live; resume (and reset the 15 minute window and the failure stop) otherwise. */
  const toggle = useCallback(() => {
    if (state === "live") return setPaused(true);
    setEpoch((n) => n + 1);
    setPaused(false);
    setExpired(false);
    setFailed(false);
  }, [state]);

  return { data, enabled, state, toggle, attach: setEl };
}
