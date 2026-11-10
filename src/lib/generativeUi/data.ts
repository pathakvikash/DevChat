/** Shape for `type: "data"` artifacts — a tabular `executeCode` result a Chart or Table can
 *  reference by id. Content is `{columns, rows}`, an array of flat objects, or CSV/TSV. */
export type DataCell = string | number | null;

export interface DataArtifactTable {
  columns: string[];
  rows: DataCell[][];
}

function cell(v: unknown): DataCell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** RFC-4180-ish scanner. Splitting on `\n` first would tear quoted fields containing a
 *  newline, which pandas `to_csv` emits. */
function splitDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endField = () => { row.push(field.trim()); field = ""; };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) endField();
    else if (c === "\n") endRow();
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Parses a data-artifact body. Throws if it isn't tabular. */
export function parseDataArtifact(content: string): DataArtifactTable {
  const text = (content ?? "").trim();
  if (!text) throw new Error("Data artifact is empty");

  if (text[0] === "{" || text[0] === "[") {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("Data artifact is not valid JSON");
    }
    if (Array.isArray(json)) {
      if (json.length === 0) throw new Error("Data artifact has no rows");
      if (!json.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
        throw new Error("Data artifact array must hold flat objects");
      }
      const columns = [...new Set(json.flatMap((r) => Object.keys(r as object)))];
      return { columns, rows: json.map((r) => columns.map((c) => cell((r as Record<string, unknown>)[c]))) };
    }
    const obj = json as { columns?: unknown; rows?: unknown };
    if (!Array.isArray(obj.columns) || !Array.isArray(obj.rows)) {
      throw new Error("Data artifact must have `columns` and `rows` arrays");
    }
    return {
      columns: obj.columns.map((c) => String(c)),
      rows: obj.rows.map((r) => (Array.isArray(r) ? r.map(cell) : [cell(r)])),
    };
  }

  const delim = text.slice(0, text.indexOf("\n") + 1 || undefined).includes("\t") ? "\t" : ",";
  const table = splitDelimited(text, delim);
  if (table.length < 2) throw new Error("Data artifact needs a header row and at least one data row");
  const columns = table[0];
  if (columns.length < 1) throw new Error("Data artifact has no columns");
  return {
    columns,
    rows: table.slice(1).map((parts) =>
      columns.map((_, i) => {
        const raw = parts[i];
        if (raw === undefined || raw === "") return null;
        const n = Number(raw.replace(/,/g, ""));
        return Number.isFinite(n) ? n : raw;
      }),
    ),
  };
}
