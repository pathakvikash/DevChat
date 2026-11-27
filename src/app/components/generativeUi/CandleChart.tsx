"use client";
import dynamic from "next/dynamic";
import { useResource } from "@/app/hooks/useResource";
import { parseOrreryArtifact, type Candle } from "@/lib/generativeUi/appData";

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
  const { data, loading, error } = useResource<{ symbol?: string; interval?: string; candles: Candle[] }>(
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
  if (dataArtifactId && loading) return <p className="text-xs text-zinc-400">Loading data…</p>;
  if (error) return <p className="text-xs text-red-400">Could not load data: {error.message}</p>;
  const sym = symbol || data?.symbol;
  const iv = interval || data?.interval;
  return (
    <div className="my-2 min-w-0">
      {(sym || iv) && (
        <p className="text-sm font-semibold text-zinc-100 mb-2">
          {sym}
          {iv && <span className="ml-2 text-xs font-normal text-zinc-400">{iv}</span>}
        </p>
      )}
      <Inner candles={data?.candles ?? candles ?? []} />
    </div>
  );
}
