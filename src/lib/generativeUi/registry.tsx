import { defineRegistry, useBoundProp } from "@json-render/react";
import { catalog } from "./catalog";
import Chart from "./Chart";

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
    Table: ({ props }) => (
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              {props.headers.map((h, i) => (
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
            {props.rows.map((row, ri) => (
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
      </div>
    ),
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
    Chart: ({ props }) => <Chart type={props.type} title={props.title} data={props.data} />,
  },
});
