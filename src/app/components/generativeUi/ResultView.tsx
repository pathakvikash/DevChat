"use client";
// Renders an OrreryResult through the same components the json-render catalog uses.
// Data is passed directly (no artifact round trip).
import { ExternalLink } from "lucide-react";
import type { OrreryResult } from "@/lib/apps/types";
import { goHref, tableResultToData } from "@/lib/generativeUi/appData";
import Chart from "@/lib/generativeUi/Chart";
import CandleChart from "./CandleChart";
import DataTable from "./DataTable";
import Model3D from "./Model3D";

const MAX_ROWS = 200;

export default function ResultView({ result, appId }: { result: OrreryResult; appId: string }) {
  switch (result.type) {
    case "table": {
      const t = tableResultToData(result);
      return (
        <div>
          {result.title && <p className="text-sm font-semibold text-zinc-100 mb-2">{result.title}</p>}
          <DataTable
            headers={t.columns}
            rows={t.rows.slice(0, MAX_ROWS).map((r) => r.map((c) => (c === null ? "" : String(c))))}
            truncated={Math.max(t.rows.length - MAX_ROWS, 0)}
          />
        </div>
      );
    }
    case "timeseries":
      return <Chart type="line" title={result.title} series={result.series} />;
    case "ohlc":
      return <CandleChart symbol={result.symbol} interval={result.interval} candles={result.candles} />;
    case "model3d":
      return <Model3D appId={appId} file={result.file} title={result.title} />;
    case "link": {
      const href = goHref(appId, result.link, result.params);
      return href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--glass-radius-md)] text-sm font-medium glass-button-primary text-white focus-visible:outline-2 focus-visible:outline-blue-500"
        >
          {result.label} <ExternalLink size={14} aria-hidden />
        </a>
      ) : null;
    }
    default:
      return <p className="text-xs text-zinc-400">This result type is not supported here.</p>;
  }
}
