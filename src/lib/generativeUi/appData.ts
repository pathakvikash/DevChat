// Pure adapters between the Orrery result contract (docs/design/apps-integration.md)
// and what the chart / candle / table renderers consume. No React, no DOM.
import { orreryResultSchema, type OrreryResult } from "@/lib/apps/types";
import type { DataArtifactTable, DataCell } from "./data";

export type Series = { name: string; points: [number, number][] };
export type Candle = { t: number; o: number; h: number; l: number; c: number; v?: number | null };

/** A data artifact that holds an OrreryResult (instead of columns/rows). Null when it is not one. */
export function parseOrreryArtifact(content: string): OrreryResult | null {
  const text = (content ?? "").trim();
  if (text[0] !== "{") return null;
  try {
    const r = orreryResultSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** ponytail: stride sampling, keeps first and last point. Min/max bucketing if spikes matter. */
export function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max || max < 2) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

/** Finite, time-sorted points only. */
export function cleanSeries(series: Series[], maxPoints = 500): Series[] {
  return series
    .map((s) => ({
      name: s.name,
      points: downsample(
        s.points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]),
        maxPoints,
      ),
    }))
    .filter((s) => s.points.length > 0);
}

export interface LwcData {
  candles: { time: number; open: number; high: number; low: number; close: number }[];
  volume: { time: number; value: number; up: boolean }[];
}

/** lightweight-charts needs UTC seconds, strictly ascending and unique, or it throws. */
export function toLwcData(candles: Candle[]): LwcData {
  const byTime = new Map<number, Candle>();
  for (const c of candles) {
    if ([c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)) byTime.set(Math.floor(c.t / 1000), c);
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);
  const out: LwcData = { candles: [], volume: [] };
  for (const time of times) {
    const c = byTime.get(time)!;
    out.candles.push({ time, open: c.o, high: c.h, low: c.l, close: c.c });
    if (typeof c.v === "number" && Number.isFinite(c.v)) out.volume.push({ time, value: c.v, up: c.c >= c.o });
  }
  return out;
}

function cell(v: unknown): DataCell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v;
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

export function tableResultToData(r: Extract<OrreryResult, { type: "table" }>): DataArtifactTable {
  return { columns: r.columns, rows: r.rows.map((row) => (Array.isArray(row) ? row.map(cell) : [cell(row)])) };
}

const APP_ID_RE = /^[a-z0-9-]{2,32}$/;
export const isAppId = (s: unknown): s is string => typeof s === "string" && APP_ID_RE.test(s);

/** Same-origin STL URL. A model-written spec may only point at Orrery's own file route. */
export function modelUrl(o: { appId?: string | null; file?: string | null; url?: string | null }): string | null {
  if (o.file && isAppId(o.appId)) return `/api/apps/${o.appId}/file?name=${encodeURIComponent(o.file)}`;
  if (o.url && /^\/api\/apps\/[a-z0-9-]{2,32}\/file\?/.test(o.url)) return o.url;
  return null;
}

/** "Open in app" link: only through Orrery's /go route with a deep-link name, never a raw URL. */
export function goHref(appId: string, link: string, params?: Record<string, string> | null): string | null {
  if (!isAppId(appId) || !link) return null;
  const q = new URLSearchParams({ link });
  if (params && Object.keys(params).length) q.set("params", JSON.stringify(params));
  return `/api/apps/${appId}/go?${q}`;
}

export const STL_MAX_BYTES = 25 * 1024 * 1024;
// ponytail: binary STL only; an ASCII STL is bounded by the byte cap alone.
export const STL_MAX_TRIANGLES = 500_000;

/** Returns a user-facing refusal, or null when the file is fine to load. */
export function stlGuard(byteLength: number, triangles?: number): string | null {
  if (byteLength > STL_MAX_BYTES) {
    return `This model is ${(byteLength / 1048576).toFixed(1)} MB, over the ${STL_MAX_BYTES / 1048576} MB preview limit.`;
  }
  if (triangles !== undefined && triangles > STL_MAX_TRIANGLES) {
    return `This model has ${triangles.toLocaleString()} triangles, too many to preview.`;
  }
  return null;
}

/** Triangle count from a binary STL header, when the size matches (otherwise it is ASCII). */
export function binaryStlTriangles(buf: ArrayBuffer): number | undefined {
  if (buf.byteLength < 84) return undefined;
  const n = new DataView(buf).getUint32(80, true);
  return 84 + n * 50 === buf.byteLength ? n : undefined;
}
