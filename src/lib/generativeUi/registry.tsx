import { defineRegistry, useBoundProp } from "@json-render/react";
import { useResource } from "@/app/hooks/useResource";
import { catalog } from "./catalog";
import { parseDataArtifact, type DataArtifactTable, type DataCell } from "./data";
import Chart from "./Chart";

/** Loads a `type: "data"` artifact body so Chart/Table can reference a large result by
 *  id instead of inlining it. Kept out of Chart.tsx, which stays presentational. */
function useArtifactData(id: string | null | undefined) {
  const { data, loading, error } = useResource<DataArtifactTable>(
    async () => {
      const res = await fetch(`/api/artifacts/${id}`);
      if (!res.ok) throw new Error(res.status === 404 ? "Data artifact not found" : `Request failed (${res.status})`);
      const artifact = (await res.json()) as { content: string };
      return parseDataArtifact(artifact.content);
    },
    [id],
    { enabled: !!id },
  );
  return { table: data, loading: !!id && loading, error };
}

const DataPending = () => <p className="text-xs text-zinc-500">Loading data…</p>;
const DataError = ({ error }: { error: Error }) => (
  <p className="text-xs text-red-400">Could not load data: {error.message}</p>
);

function toNumber(v: DataCell): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function chartDataFrom(t: DataArtifactTable, labelColumn: string | null, valueColumn: string | null) {
  const li = Math.max(t.columns.indexOf(labelColumn ?? ""), 0);
  let vi = valueColumn ? t.columns.indexOf(valueColumn) : -1;
  // Default: first *other* column that holds numbers — the label column is
  // often numeric too (years, ids) and plotting it against itself is useless.
  if (vi < 0) vi = t.columns.findIndex((_, i) => i !== li && t.rows.some((r) => toNumber(r[i]) !== null));
  if (vi < 0) return [];
  return t.rows.map((r) => ({ label: String(r[li] ?? ""), value: toNumber(r[vi]) ?? 0 }));
}

// ponytail: hard row cap so a 100k-row artifact can't hang the chat bubble.
// Raise it or paginate if someone actually wants to scroll that far.
const MAX_TABLE_ROWS = 200;

function tableFrom(t: DataArtifactTable, columns: string[] | null) {
  const idx = columns?.length
    ? columns.map((c) => t.columns.indexOf(c)).filter((i) => i >= 0)
    : t.columns.map((_, i) => i);
  return {
    headers: idx.map((i) => t.columns[i]),
    rows: t.rows.slice(0, MAX_TABLE_ROWS).map((r) => idx.map((i) => (r[i] === null || r[i] === undefined ? "" : String(r[i])))),
    truncated: Math.max(t.rows.length - MAX_TABLE_ROWS, 0),
  };
}

const HEADING_CLASSES: Record<1 | 2 | 3, string> = {
  1: "text-xl font-semibold text-zinc-100",
  2: "text-lg font-semibold text-zinc-100",
  3: "text-base font-medium text-zinc-200",
};

type Variant = "default" | "success" | "warning" | "error";
type AlertVariant = "info" | "success" | "warning" | "error";

const BADGE_CLASSES: Record<Variant, string> = {
  default: "bg-zinc-800 text-zinc-300 border-zinc-700",
  success: "bg-emerald-950/60 text-emerald-400 border-emerald-900/50",
  warning: "bg-amber-950/60 text-amber-400 border-amber-900/50",
  error: "bg-red-950/60 text-red-400 border-red-900/50",
};

const ALERT_CLASSES: Record<AlertVariant, string> = {
  info: "border-blue-900/50 bg-blue-950/30 text-blue-300",
  success: "border-emerald-900/50 bg-emerald-950/30 text-emerald-300",
  warning: "border-amber-900/50 bg-amber-950/30 text-amber-300",
  error: "border-red-900/50 bg-red-950/30 text-red-300",
};

const SAFE_URL_RE = /^https?:\/\//i;

export const { registry } = defineRegistry(catalog, {
  components: {
    Card: ({ props, children }) => (
      <div className="my-2 glass-card rounded-[var(--glass-radius-md)] overflow-hidden">
        <div className="px-4 py-3">
          {props.title && (
            <p className="text-sm font-semibold text-zinc-100 mb-1">{props.title}</p>
          )}
          {props.subtitle && (
            <p className="text-xs text-zinc-400 mb-2">{props.subtitle}</p>
          )}
          <div className="space-y-2">{children}</div>
        </div>
      </div>
    ),
    Heading: ({ props }) => {
      const level = (props.level ?? 2) as 1 | 2 | 3;
      const Tag = (`h${level}` as unknown) as "h1" | "h2" | "h3";
      return <Tag className={HEADING_CLASSES[level]}>{props.text}</Tag>;
    },
    Text: ({ props }) => <p className="text-sm text-zinc-300">{props.content}</p>,
    Button: ({ props, emit }) => (
      <button
        onClick={() => emit("press")}
        className={`px-3 py-1.5 rounded-[var(--glass-radius-md)] text-sm font-medium transition-all border ${
          props.variant === "secondary" ? "glass-button text-zinc-300" : "glass-button-primary text-white"
        }`}
      >
        {props.label}
      </button>
    ),
    List: ({ props }) => (
      <ul className="list-disc list-inside text-sm text-zinc-300 space-y-1">
        {props.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    ),
    Badge: ({ props }) => (
      <span
        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${
          BADGE_CLASSES[(props.variant ?? "default") as Variant]
        }`}
      >
        {props.text}
      </span>
    ),
    Divider: () => <hr className="border-[var(--glass-border)] my-2" />,
    Alert: ({ props }) => (
      <div
        className={`rounded-[var(--glass-radius-md)] border px-4 py-3 text-sm ${
          ALERT_CLASSES[(props.variant ?? "info") as AlertVariant]
        }`}
      >
        {props.title && <p className="font-semibold mb-1">{props.title}</p>}
        <p>{props.message}</p>
      </div>
    ),
    Table: ({ props }) => {
      const { table, loading, error } = useArtifactData(props.dataArtifactId);
      if (loading) return <DataPending />;
      if (error) return <DataError error={error} />;
      const { headers, rows, truncated } = table
        ? tableFrom(table, props.columns)
        : { headers: props.headers ?? [], rows: props.rows ?? [], truncated: 0 };
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                {headers.map((h, i) => (
                  <th
                    key={i}
                    className="text-left px-3 py-2 border-b border-[var(--glass-border)] text-zinc-400 font-medium"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 border-b border-[var(--glass-border)] text-zinc-300">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {truncated > 0 && (
            <p className="text-xs text-zinc-500 mt-1">…{truncated} more rows not shown.</p>
          )}
        </div>
      );
    },
    Link: ({ props }) =>
      SAFE_URL_RE.test(props.href) ? (
        <a
          href={props.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:underline break-all text-sm"
        >
          {props.label}
        </a>
      ) : (
        <span className="text-zinc-500 text-sm">{props.label}</span>
      ),
    Input: ({ props, bindings }) => {
      const [value, setValue] = useBoundProp(props.value, bindings?.value);
      return (
        <label className="block text-sm">
          <span className="block text-xs text-zinc-400 mb-1">{props.label}</span>
          <input
            value={value ?? ""}
            placeholder={props.placeholder ?? ""}
            onChange={(e) => setValue(e.target.value)}
            className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
          />
        </label>
      );
    },
    Checkbox: ({ props, bindings }) => {
      const [checked, setChecked] = useBoundProp(props.checked ?? false, bindings?.checked);
      return (
        <label className="flex items-center gap-2 text-sm text-zinc-200 cursor-pointer">
          <input
            type="checkbox"
            checked={!!checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="w-4 h-4 accent-blue-500 rounded border-[var(--glass-border)] bg-[var(--glass-bg)]"
          />
          {props.label}
        </label>
      );
    },
    Select: ({ props, bindings }) => {
      const [value, setValue] = useBoundProp(props.value, bindings?.value);
      return (
        <label className="block text-sm">
          <span className="block text-xs text-zinc-400 mb-1">{props.label}</span>
          <select
            value={value ?? ""}
            onChange={(e) => setValue(e.target.value)}
            className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Select…
            </option>
            {props.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      );
    },
    Chart: ({ props }) => {
      const { table, loading, error } = useArtifactData(props.dataArtifactId);
      if (loading) return <DataPending />;
      if (error) return <DataError error={error} />;
      const data = table
        ? chartDataFrom(table, props.labelColumn, props.valueColumn)
        : props.data ?? [];
      return <Chart type={props.type} title={props.title} data={data} />;
    },
  },
});
