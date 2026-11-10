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
const GRID_COLOR = "#3f3f46"; // zinc-700 — recessive baseline/gridline
const TEXT_MUTED = "#a1a1aa"; // zinc-400
const TEXT_PRIMARY = "#e4e4e7"; // zinc-200

interface ChartDatum {
  label: string;
  value: number;
}

interface ChartProps {
  type: "bar" | "line" | "pie";
  title?: string | null;
  data: ChartDatum[];
}

const WIDTH = 400;
const HEIGHT = 220;
const PAD = { top: 24, right: 12, bottom: 32, left: 12 };

export default function Chart({ type, title, data }: ChartProps) {
  if (!data || data.length === 0) {
    return <p className="text-xs text-zinc-500">No data to chart.</p>;
  }
  return (
    <div className="my-2">
      {title && <p className="text-sm font-semibold text-zinc-100 mb-2">{title}</p>}
      {type === "bar" && <BarChart data={data} />}
      {type === "line" && <LineChart data={data} />}
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
  let angle = -90; // start at 12 o'clock

  const slices = sliced.map((d, i) => {
    const frac = d.value / total;
    const startAngle = angle;
    const endAngle = angle + frac * 360;
    angle = endAngle;
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
