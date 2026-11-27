"use client";
import dynamic from "next/dynamic";
import { useResource } from "@/app/hooks/useResource";
import { useLiveResult } from "@/app/hooks/useLiveResult";
import type { RefreshSpec } from "@/lib/apps/types";
import { parseOrreryArtifact, type Candle } from "@/lib/generativeUi/appData";
import LiveBadge from "./LiveBadge";

// Lazy + client-only: lightweight-charts stays out of the main bundle.
const Inner = dynamic(() => import("./CandleChartInner"), {
  ssr: false,
  loading: () => <p className="text-xs text-zinc-400">Loading chart…</p>,
});

interface Props {
  symbol?: string | null;
  interval?: string | null;
  dataArtifactId?: string | null;
  candles?: Candle[] | null;
}

export default function CandleChart({ symbol, interval, dataArtifactId, candles }: Props) {
  const { data, loading, error } = useResource<{ symbol?: string; interval?: string; candles: Candle[]; refresh?: RefreshSpec }>(
    async () => {
      const res = await fetch(`/api/artifacts/${dataArtifactId}`);
      if (!res.ok) throw new Error(res.status === 404 ? "Data artifact not found" : `Request failed (${res.status})`);
      const r = parseOrreryArtifact(((await res.json()) as { content: string }).content);
      if (r?.type !== "ohlc") throw new Error("Data artifact does not hold candles");
      return r;
    },
    [dataArtifactId],
    { enabled: !!dataArtifactId },
  );
  const { attach, ...live } = useLiveResult(dataArtifactId, data?.refresh, "ohlc");
  if (dataArtifactId && loading) return <p className="text-xs text-zinc-400">Loading data…</p>;
  if (error) return <p className="text-xs text-red-400">Could not load data: {error.message}</p>;
  const sym = symbol || data?.symbol;
  const iv = interval || data?.interval;
  return (
    <div className="my-2 min-w-0" ref={attach}>
      {live.enabled && <LiveBadge state={live.state} onToggle={live.toggle} />}
      {(sym || iv) && (
        <p className="text-sm font-semibold text-zinc-100 mb-2">
          {sym}
          {iv && <span className="ml-2 text-xs font-normal text-zinc-400">{iv}</span>}
        </p>
      )}
      <Inner candles={live.data?.candles ?? data?.candles ?? candles ?? []} />
    </div>
  );
}
