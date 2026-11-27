// Scales, ticks and hit-testing for the multi-series time chart. Pure.
import type { Series } from "./appData";

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}

export interface TimeLayout {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  x: (ms: number) => number;
  y: (v: number) => number;
  yTicks: number[];
  xTicks: number[];
}

export function buildLayout(
  series: Series[],
  box: { left: number; top: number; width: number; height: number },
  includeZero: boolean,
): TimeLayout {
  const ts = series.flatMap((s) => s.points.map((p) => p[0]));
  const vs = series.flatMap((s) => s.points.map((p) => p[1]));
  const xMin = Math.min(...ts);
  const xMax = Math.max(...ts);
  let lo = Math.min(...vs, ...(includeZero ? [0] : []));
  let hi = Math.max(...vs, ...(includeZero ? [0] : []));
  if (hi === lo) { hi += 1; lo -= includeZero ? 0 : 1; }
  const pad = includeZero ? 0 : (hi - lo) * 0.08;
  const yTicks = niceTicks(lo - pad, hi + pad);
  const yMin = Math.min(lo - pad, yTicks[0]);
  const yMax = Math.max(hi + pad, yTicks[yTicks.length - 1]);
  const xr = xMax - xMin || 1;
  return {
    xMin, xMax, yMin, yMax, yTicks,
    xTicks: [0, 1 / 3, 2 / 3, 1].map((f) => xMin + f * xr),
    x: (ms) => box.left + ((ms - xMin) / xr) * box.width,
    y: (v) => box.top + box.height - ((v - yMin) / (yMax - yMin)) * box.height,
  };
}

/** Index of the entry in an ascending array closest to `t`. */
export function nearestIndex(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1; else hi = mid;
  }
  return lo > 0 && Math.abs(times[lo - 1] - t) <= Math.abs(times[lo] - t) ? lo - 1 : lo;
}

export function formatTime(ms: number, spanMs: number): string {
  const d = new Date(ms);
  const DAY = 86_400_000;
  if (spanMs <= 2 * DAY) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (spanMs <= 400 * DAY) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export const formatValue = (v: number) =>
  Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : +v.toPrecision(4) + "";
