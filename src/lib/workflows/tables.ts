import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

// DevChat tables (3.2): what a workflow's "Save to table" card writes to, and what /tables shows.

export const COLUMN_TYPES = ["text", "longtext", "url", "number", "date"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];
export interface Column {
  key: string;
  label: string;
  type: ColumnType;
}
export interface TableInfo {
  id: string;
  name: string;
  columns: Column[];
  statuses: string[];
}
/** A row as a card hands it on: its data, plus `_rowId` and `status`. */
export type RowItem = Record<string, unknown> & { _rowId: string; status: string };

export const MAX_TABLE_ROWS = 10_000;
export const MAX_WRITE_ROWS = 1_000;
/** A key over this many bytes (UTF-8, after percent-encoding) is stored as its sha256: Postgres cannot index a value over 2,704 bytes in the unique key. */
export const MAX_KEY_BYTES = 1000;
export const DEFAULT_STATUS = "new";
/** What the News template's table starts with: the fields a web search result has. */
export const NEWS_COLUMNS: Column[] = [
  { key: "title", label: "Title", type: "text" },
  { key: "url", label: "URL", type: "url" },
  { key: "snippet", label: "Snippet", type: "longtext" },
  { key: "query", label: "Query", type: "text" },
];
export const NEWS_STATUSES = ["new", "read"];
/** What the Jobs template's table starts with: a job from a board, and the draft the agent writes for it. */
export const JOB_COLUMNS: Column[] = [
  { key: "title", label: "Title", type: "text" },
  { key: "company", label: "Company", type: "text" },
  { key: "location", label: "Location", type: "text" },
  { key: "url", label: "URL", type: "url" },
  { key: "description", label: "Description", type: "longtext" },
  { key: "source", label: "Source", type: "text" },
  { key: "coverLetter", label: "Cover letter", type: "longtext" },
  { key: "cvNotes", label: "CV notes", type: "longtext" },
  { key: "answers", label: "Form answers", type: "longtext" },
  { key: "applyUrl", label: "Apply link", type: "url" },
];
export const JOB_STATUSES = ["new", "picked", "drafted", "applied"];

function parseJson<T>(text: string, fallback: T): T {
  try {
    const v = JSON.parse(text);
    return v === null || v === undefined ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

export function toTableInfo(row: { id: string; name: string; columns: string; statuses: string }): TableInfo {
  const columns = parseJson<Column[]>(row.columns, []);
  const statuses = parseJson<string[]>(row.statuses, [DEFAULT_STATUS]);
  return { id: row.id, name: row.name, columns: Array.isArray(columns) ? columns : [], statuses: Array.isArray(statuses) && statuses.length ? statuses : [DEFAULT_STATUS] };
}

/** A table by id with no owner check: for a caller that already holds the TableInfo. */
async function loadTableById(id: string): Promise<TableInfo | null> {
  const row = await prisma.dataTable.findFirst({ where: { id } });
  return row ? toTableInfo(row) : null;
}

/** The user's table by id, or null (also when it belongs to someone else). */
export async function loadTable(userId: string, id: string): Promise<TableInfo | null> {
  const row = await prisma.dataTable.findFirst({ where: { id, userId } });
  return row ? toTableInfo(row) : null;
}

export function parseRowData(data: string): Record<string, unknown> {
  const v = parseJson<unknown>(data, {});
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * The key rows are matched on. A URL is normalised: lowercase host, no trailing slash, `utm_*` parameters dropped.
 * Anything else is just trimmed. Empty stays empty.
 */
export function normalizeKey(raw: unknown): string {
  const key = normalizeUrl(String(raw ?? "").trim());
  return Buffer.byteLength(key) > MAX_KEY_BYTES ? `sha256:${createHash("sha256").update(key).digest("hex")}` : key;
}

function normalizeUrl(s: string): string {
  if (!/^https?:\/\//i.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return s;
  }
  // The query is always rebuilt, so a page linked with %20 or + in one place and the other way in another is one key.
  const params = new URLSearchParams();
  for (const [k, v] of u.searchParams) if (!k.toLowerCase().startsWith("utm_")) params.append(k, v);
  const query = params.toString();
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}${query ? `?${query}` : ""}${u.hash}`;
}

/** The type a new column gets from the first value written to it. */
export function guessType(value: unknown): ColumnType {
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    if (/^https?:\/\/\S+$/i.test(value)) return "url";
    if (value.length > 200) return "longtext";
  }
  return "text";
}

/** One CSV cell (RFC 4180). A text cell that starts with = + - @ or a tab or return (after any spaces) gets a leading ' so a spreadsheet won't run it. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (typeof value === "string" && /^(?:[=+\-@\t\r]|\s+[=+\-@])/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: Column[], rows: { status: string; data: Record<string, unknown> }[]): string {
  const head = [...columns.map((c) => c.label || c.key), "Status"].map(csvCell).join(",");
  const lines = rows.map((r) => [...columns.map((c) => r.data[c.key]), r.status].map(csvCell).join(","));
  // The BOM makes Excel read the file as UTF-8.
  return `\uFEFF${[head, ...lines].join("\r\n")}\r\n`;
}

export interface RowInput {
  /** The dedupe key; null for a row with none. */
  key: string | null;
  data: Record<string, unknown>;
  /** New rows get it (default "new"). An existing row gets it only on `update`. */
  status?: string;
}

const item = (row: { id: string; status: string }, data: Record<string, unknown>): RowItem => ({ ...data, _rowId: row.id, status: row.status });

/**
 * Adds or updates rows by key. `upsert` inserts rows with no match and updates the rest (their status stays unless
 * given by `update`); `update` touches matches only and lists the keys it did not find. Columns and statuses the data
 * brings are added to the table. Throws when a cap would be passed.
 */
async function writeRowsOnce(
  table: TableInfo,
  action: "upsert" | "update",
  inputs: RowInput[],
): Promise<{ inserted: RowItem[]; updated: RowItem[]; missing: string[]; addedColumns: string[] }> {
  if (inputs.length > MAX_WRITE_ROWS) throw new Error(`A write can touch at most ${MAX_WRITE_ROWS.toLocaleString("en-US")} rows; this one has ${inputs.length.toLocaleString("en-US")}`);
  // The first row for a key wins: two items that normalise to the same key are one row.
  const seen = new Set<string>();
  const rows = inputs.filter((r) => {
    if (r.key === null) return true;
    if (seen.has(r.key)) return false;
    seen.add(r.key);
    return true;
  });
  const keys = [...seen];
  const existing = keys.length ? await prisma.dataTableRow.findMany({ where: { tableId: table.id, key: { in: keys } } }) : [];
  const byKey = new Map(existing.map((r) => [r.key as string, r]));

  const fresh = action === "upsert" ? rows.filter((r) => r.key === null || !byKey.has(r.key)) : [];
  const matched = rows.filter((r) => r.key !== null && byKey.has(r.key));
  const missing = action === "update" ? rows.filter((r) => r.key === null || !byKey.has(r.key)).map((r) => r.key ?? "(no key)") : [];
  if (fresh.length > 0) {
    const have = await prisma.dataTableRow.count({ where: { tableId: table.id } });
    if (have + fresh.length > MAX_TABLE_ROWS) throw new Error(`“${table.name}” can hold ${MAX_TABLE_ROWS.toLocaleString("en-US")} rows; this write would pass that`);
  }

  const columns = [...table.columns];
  const addedColumns: string[] = [];
  for (const r of [...fresh, ...matched]) {
    for (const [k, v] of Object.entries(r.data)) {
      if (columns.some((c) => c.key === k)) continue;
      columns.push({ key: k, label: k, type: guessType(v) });
      addedColumns.push(k);
    }
  }
  const statuses = [...table.statuses];
  for (const r of [...fresh, ...matched]) if (r.status && !statuses.includes(r.status)) statuses.push(r.status);

  const creates = fresh.map((r) => prisma.dataTableRow.create({ data: { tableId: table.id, key: r.key, status: r.status || DEFAULT_STATUS, data: JSON.stringify(r.data) } }));
  const updates = matched.map((r) => {
    const old = byKey.get(r.key as string)!;
    const data = { ...parseRowData(old.data), ...r.data };
    const status = action === "update" && r.status ? r.status : old.status;
    return { r, data, status, op: prisma.dataTableRow.update({ where: { id: old.id }, data: { data: JSON.stringify(data), status } }) };
  });
  const tableChanged = addedColumns.length > 0 || statuses.length !== table.statuses.length;
  const ops = [...creates, ...updates.map((u) => u.op), ...(tableChanged ? [prisma.dataTable.update({ where: { id: table.id }, data: { columns: JSON.stringify(columns), statuses: JSON.stringify(statuses) } })] : [])];
  const done = ops.length ? await prisma.$transaction(ops as never) : [];
  const results = done as unknown as { id: string; status: string }[];

  return {
    inserted: fresh.map((r, i) => item(results[i], r.data)),
    updated: updates.map((u, i) => item(results[fresh.length + i], u.data)),
    missing,
    addedColumns,
  };
}

const isClash = (e: unknown) => (e as { code?: string } | null)?.code === "P2002";

/**
 * Two runs saving to one table at once can both see a key as new, and the second insert hits the unique key. The write
 * is one transaction, so nothing was saved: it is read again, and the clashes are updates this time. A second clash is
 * reported in plain words, never as database text.
 */
export async function writeRows(table: TableInfo, action: "upsert" | "update", inputs: RowInput[]): ReturnType<typeof writeRowsOnce> {
  try {
    return await writeRowsOnce(table, action, inputs);
  } catch (e) {
    if (!isClash(e)) throw e;
  }
  // Read the table again: the other run may have added columns or statuses, which this write must not overwrite.
  const fresh = (await loadTableById(table.id)) ?? table;
  try {
    return await writeRowsOnce(fresh, action, inputs);
  } catch (e) {
    if (isClash(e)) throw new Error(`Another run is saving to “${table.name}” at the same time. Run this one again.`);
    throw e;
  }
}

/** Rows of this table, by id, that carry one of `statuses`: what a Pick rows card may hand on. Others (another table's, or a status no longer on offer) are left out. Kept in the order of `ids`. */
export async function offeredRows(tableId: string, statuses: string[], ids: string[]): Promise<RowItem[]> {
  const rows = await prisma.dataTableRow.findMany({ where: { tableId, id: { in: ids }, status: { in: statuses } } });
  const byId = new Map(rows.map((r) => [r.id, item(r, parseRowData(r.data))]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}
