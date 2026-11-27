// Builders for the Orrery result contract, plus the MCP tool response wrapper.
// Caps keep payloads small; builders throw if you exceed them (Orrery stores big data as an artifact anyway).
export const CAPS = { rows: 1000, points: 5000, candles: 5000 } as const;

export type OrreryResult =
  | { orrery: 1; type: "table"; title?: string; columns: string[]; rows: unknown[][] }
  | { orrery: 1; type: "timeseries"; title?: string; series: { name: string; points: [number, number][] }[] }
  | { orrery: 1; type: "ohlc"; symbol: string; interval: string; candles: { t: number; o: number; h: number; l: number; c: number; v?: number }[] }
  | { orrery: 1; type: "model3d"; format: "stl"; title?: string; file: string }
  | { orrery: 1; type: "job"; jobId: string; statusTool: string; title?: string; pollMs?: number }
  | { orrery: 1; type: "link"; label: string; link: string; params?: Record<string, string> };

const cap = (what: string, n: number, max: number) => {
  if (n > max) throw new Error(`${what}: ${n} exceeds cap of ${max}`);
};

export const table = (columns: string[], rows: unknown[][], title?: string): OrreryResult => {
  cap("table rows", rows.length, CAPS.rows);
  return { orrery: 1, type: "table", ...(title && { title }), columns, rows };
};

export const timeseries = (series: { name: string; points: [number, number][] }[], title?: string): OrreryResult => {
  for (const s of series) cap(`series "${s.name}" points`, s.points.length, CAPS.points);
  return { orrery: 1, type: "timeseries", ...(title && { title }), series };
};

export const ohlc = (symbol: string, interval: string, candles: { t: number; o: number; h: number; l: number; c: number; v?: number }[]): OrreryResult => {
  cap("candles", candles.length, CAPS.candles);
  return { orrery: 1, type: "ohlc", symbol, interval, candles };
};

/** `file` is an app-relative file id; Orrery fetches it from your /file route, STL only. */
export const model3d = (file: string, title?: string): OrreryResult => ({ orrery: 1, type: "model3d", format: "stl", ...(title && { title }), file });

export const job = (jobId: string, statusTool: string, opts: { title?: string; pollMs?: number } = {}): OrreryResult => ({
  orrery: 1,
  type: "job",
  jobId,
  statusTool,
  ...opts,
});

/** `linkKey` is a key of your manifest deepLinks, never a URL. */
export const link = (label: string, linkKey: string, params?: Record<string, string>): OrreryResult => ({
  orrery: 1,
  type: "link",
  label,
  link: linkKey,
  ...(params && { params }),
});

/** MCP tool response: short text for models that ignore structured content + the result itself. */
export const toolResult = (result: OrreryResult | Record<string, unknown>, textSummary: string) => ({
  content: [{ type: "text" as const, text: textSummary }],
  structuredContent: result,
});
