// Dependency-free inline-SVG chart for the generative UI catalog. No charting
// library is installed in this app, and pulling one in for a handful of
// AI-generated bar/line/pie charts inside a chat bubble isn't worth it.
//
// Palette: validated dark-mode categorical order from the dataviz skill's
// reference palette (worst adjacent CVD ΔE 8.4, normal-vision ΔE 19.3 — both
// clear the gate). Bar/line are single-series magnitude, so they use ONE hue
// (the sequential blue) rather than a color per bar — color should encode
// identity, not decorate a single metric. Pie slices ARE distinct identities,
// so they get the fixed categorical order, capped at 8 with overflow folded
// into "Other".
import { useRef, useState } from "react";
import { cleanSeries, type Series } from "./appData";
import { buildLayout, formatTime, formatValue, nearestIndex } from "./timeSeries";

const DARK_CATEGORICAL = [
  "#3987e5", // blue
  "#d95926", // orange
  "#199e70", // aqua
  "#c98500", // yellow
  "#d55181", // magenta
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
];
const SEQUENTIAL_BLUE = "#3987e5";
// Theme tokens: globals.css remaps --color-zinc-* under [data-theme="light"].
const GRID_COLOR = "var(--color-zinc-700, #3f3f46)"; // recessive baseline/gridline
const TEXT_MUTED = "var(--color-zinc-400, #a1a1aa)";
const TEXT_PRIMARY = "var(--color-zinc-200, #e4e4e7)";

interface ChartDatum {
  label: string;
  value: number;
}

interface ChartProps {
  type: "bar" | "line" | "area" | "pie";
  title?: string | null;
  data?: ChartDatum[] | null;
  /** Multi-series time chart (line/area); points are [epoch ms, value]. Takes precedence over `data`. */
  series?: Series[] | null;
}

const WIDTH = 400;
const HEIGHT = 220;
const PAD = { top: 24, right: 12, bottom: 32, left: 12 };

export default function Chart({ type, title, data, series }: ChartProps) {
  const clean = series?.length ? cleanSeries(series) : [];
  if (clean.length > 0) {
    return (
      <div className="my-2">
        {title && <p className="text-sm font-semibold text-zinc-100 mb-2">{title}</p>}
        <TimeSeriesChart series={clean} area={type === "area"} />
      </div>
    );
  }
  if (!data || data.length === 0) {
    return <p className="text-xs text-zinc-500">No data to chart.</p>;
  }
  return (
    <div className="my-2">
      {title && <p className="text-sm font-semibold text-zinc-100 mb-2">{title}</p>}
      {type === "bar" && <BarChart data={data} />}
      {(type === "line" || type === "area") && <LineChart data={data} />}
      {type === "pie" && <PieChart data={data} />}
    </div>
  );
}

function truncateLabel(label: string): string {
  return label.length > 10 ? label.slice(0, 9) + "…" : label;
}

function BarChart({ data }: { data: ChartDatum[] }) {
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const gap = 8;
  const barW = (innerW - gap * (data.length - 1)) / data.length;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full max-w-md" role="img" aria-label="Bar chart">
      <line
        x1={PAD.left}
        y1={HEIGHT - PAD.bottom}
        x2={WIDTH - PAD.right}
        y2={HEIGHT - PAD.bottom}
        stroke={GRID_COLOR}
        strokeWidth={1}
      />
      {data.map((d, i) => {
        const h = Math.max((d.value / max) * innerH, 1);
        const x = PAD.left + i * (barW + gap);
        const y = HEIGHT - PAD.bottom - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={h} rx={4} fill={SEQUENTIAL_BLUE} />
            <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize={11} fill={TEXT_PRIMARY}>
              {d.value}
            </text>
            <text
              x={x + barW / 2}
              y={HEIGHT - PAD.bottom + 16}
              textAnchor="middle"
              fontSize={10}
              fill={TEXT_MUTED}
            >
              {truncateLabel(d.label)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ data }: { data: ChartDatum[] }) {
  const max = Math.max(...data.map((d) => d.value), 0);
  const min = Math.min(...data.map((d) => d.value), 0);
  const range = max - min || 1;
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

  const points = data.map((d, i) => ({
    x: PAD.left + i * stepX,
    y: PAD.top + innerH - ((d.value - min) / range) * innerH,
    d,
  }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full max-w-md" role="img" aria-label="Line chart">
      <line
        x1={PAD.left}
        y1={HEIGHT - PAD.bottom}
        x2={WIDTH - PAD.right}
        y2={HEIGHT - PAD.bottom}
        stroke={GRID_COLOR}
        strokeWidth={1}
      />
      <path d={path} fill="none" stroke={SEQUENTIAL_BLUE} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={4} fill={SEQUENTIAL_BLUE} />
          <text x={p.x} y={HEIGHT - PAD.bottom + 16} textAnchor="middle" fontSize={10} fill={TEXT_MUTED}>
            {truncateLabel(p.d.label)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const clampedEnd = Math.min(endDeg, startDeg + 359.999); // avoid a degenerate full-circle path
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, clampedEnd);
  const largeArc = clampedEnd - startDeg > 180 ? 1 : 0;
  return `M ${cx},${cy} L ${start.x},${start.y} A ${r},${r} 0 ${largeArc} 1 ${end.x},${end.y} Z`;
}

function PieChart({ data }: { data: ChartDatum[] }) {
  const MAX_SLICES = 8;
  const sliced =
    data.length > MAX_SLICES
      ? [
          ...data.slice(0, MAX_SLICES - 1),
          {
            label: "Other",
            value: data.slice(MAX_SLICES - 1).reduce((s, d) => s + d.value, 0),
          },
        ]
      : data;
  const total = sliced.reduce((s, d) => s + d.value, 0) || 1;
  const cx = 90;
  const cy = 90;
  const r = 70;
  const slices = sliced.map((d, i) => {
    const frac = d.value / total;
    const startAngle = -90 + (sliced.slice(0, i).reduce((s, x) => s + x.value, 0) / total) * 360; // 12 o'clock start
    const endAngle = startAngle + frac * 360;
    return {
      path: arcPath(cx, cy, r, startAngle, endAngle),
      color: DARK_CATEGORICAL[i % DARK_CATEGORICAL.length],
      label: d.label,
      pct: frac * 100,
    };
  });

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <svg viewBox="0 0 180 180" className="w-40 h-40 shrink-0" role="img" aria-label="Pie chart">
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} stroke="#09090b" strokeWidth={2} />
        ))}
      </svg>
      <ul className="text-xs space-y-1">
        {slices.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-zinc-300">{s.label}</span>
            <span className="text-zinc-500">{s.pct.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const T_BOX = { left: 44, top: 12, width: WIDTH - 44 - 12, height: HEIGHT - 12 - 28 };

function TimeSeriesChart({ series, area }: { series: Series[]; area: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null); // epoch ms
  const L = buildLayout(series, T_BOX, area);
  const span = L.xMax - L.xMin;
  const color = (i: number) => DARK_CATEGORICAL[i % DARK_CATEGORICAL.length];
  const base = T_BOX.top + T_BOX.height;

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const px = ((e.clientX - r.left) / r.width) * WIDTH;
    const f = Math.min(Math.max((px - T_BOX.left) / T_BOX.width, 0), 1);
    const first = series[0].points.map((p) => p[0]);
    setHover(first[nearestIndex(first, L.xMin + f * (L.xMax - L.xMin))]);
  };

  const hits = hover === null ? [] : series.map((s, i) => {
    const pt = s.points[nearestIndex(s.points.map((p) => p[0]), hover)];
    return { name: s.name, i, t: pt[0], v: pt[1] };
  });
  const hx = hover === null ? 0 : L.x(hover);

  return (
    <div className="relative w-full max-w-xl">
      <svg
        ref={ref}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-pan-y"
        role="img"
        aria-label={`${area ? "Area" : "Line"} chart of ${series.map((s) => s.name).join(", ")} over time`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {L.yTicks.map((v) => (
          <g key={v}>
            <line x1={T_BOX.left} x2={WIDTH - 12} y1={L.y(v)} y2={L.y(v)} stroke={GRID_COLOR} strokeWidth={1} strokeOpacity={0.6} />
            <text x={T_BOX.left - 6} y={L.y(v) + 3} textAnchor="end" fontSize={10} fill={TEXT_MUTED}>{formatValue(v)}</text>
          </g>
        ))}
        {L.xTicks.map((t, i) => (
          <text key={i} x={L.x(t)} y={HEIGHT - 10} textAnchor={i === 0 ? "start" : i === 3 ? "end" : "middle"} fontSize={10} fill={TEXT_MUTED}>
            {formatTime(t, span)}
          </text>
        ))}
        {series.map((s, i) => {
          const d = s.points.map((p, j) => `${j === 0 ? "M" : "L"}${L.x(p[0]).toFixed(1)},${L.y(p[1]).toFixed(1)}`).join(" ");
          const zero = Math.min(Math.max(L.y(0), T_BOX.top), base);
          return (
            <g key={s.name + i}>
              {area && (
                <path
                  d={`${d} L${L.x(s.points[s.points.length - 1][0]).toFixed(1)},${zero} L${L.x(s.points[0][0]).toFixed(1)},${zero} Z`}
                  fill={color(i)}
                  fillOpacity={series.length > 1 ? 0.15 : 0.25}
                />
              )}
              <path d={d} fill="none" stroke={color(i)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        })}
        {hover !== null && (
          <g>
            <line x1={hx} x2={hx} y1={T_BOX.top} y2={base} stroke={TEXT_MUTED} strokeWidth={1} strokeDasharray="3 3" />
            {hits.map((h) => (
              <circle key={h.i} cx={L.x(h.t)} cy={L.y(h.v)} r={4} fill={color(h.i)} stroke="var(--background, #09090b)" strokeWidth={1.5} />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 glass-card rounded-[var(--glass-radius-sm)] px-2 py-1 text-[11px] text-zinc-200 whitespace-nowrap"
          style={{ left: `${(hx / WIDTH) * 100}%`, transform: hx > WIDTH / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)" }}
        >
          <div className="text-zinc-400">{new Date(hover).toLocaleString()}</div>
          {hits.map((h) => (
            <div key={h.i} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color(h.i) }} />
              {series.length > 1 && <span className="text-zinc-400">{h.name}</span>}
              <span className="font-medium">{formatValue(h.v)}</span>
            </div>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400">
          {series.map((s, i) => (
            <li key={s.name + i} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color(i) }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
