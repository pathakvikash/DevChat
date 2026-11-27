"use client";
// lightweight-charts is imported here only; CandleChart.tsx loads this file lazily.
import { useEffect, useMemo, useRef } from "react";
import { ColorType, CrosshairMode, createChart } from "lightweight-charts";
import type { ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { toLwcData, type Candle, type LwcData } from "@/lib/generativeUi/appData";

const UP = "#199e70";
const DOWN = "#e66767";
const toVol = (d: LwcData["volume"][number]) => ({ time: d.time as UTCTimestamp, value: d.value, color: d.up ? `${UP}88` : `${DOWN}88` });
const HEIGHT = 320;

/** Canvas can't read CSS variables, so resolve the theme tokens to concrete colours. */
function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const fg = cs.getPropertyValue("--foreground").trim() || "#fafaf9";
  const grid = cs.getPropertyValue("--glass-border").trim() || "rgba(255,255,255,0.08)";
  return { fg, grid, border: cs.getPropertyValue("--glass-border-strong").trim() || grid };
}

export default function CandleChartInner({ candles }: { candles: Candle[] }) {
  const host = useRef<HTMLDivElement>(null);
  // Spec re-renders hand us a new array identity; key the chart on content instead.
  const sig = `${candles.length}|${candles[0]?.t}|${candles.at(-1)?.t}|${candles.at(-1)?.c}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => toLwcData(candles), [sig]);

  const series = useRef<{ candle: ISeriesApi<"Candlestick">; vol?: ISeriesApi<"Histogram"> } | null>(null);
  const shown = useRef<LwcData | null>(null);
  const hasData = data.candles.length > 0;

  // Later data (live refresh): update() the tail in place when it still contains the last bar we drew; the chart, zoom and scroll stay.
  useEffect(() => {
    const s = series.current;
    const prev = shown.current;
    if (!s || !prev || prev === data) return;
    const lastT = prev.candles.at(-1)?.time;
    const tail = data.candles.findIndex((d) => d.time === lastT);
    if (tail < 0) {
      s.candle.setData(data.candles.map((d) => ({ ...d, time: d.time as UTCTimestamp })));
      s.vol?.setData(data.volume.map(toVol));
    } else {
      for (const d of data.candles.slice(tail)) s.candle.update({ ...d, time: d.time as UTCTimestamp });
      const vt = data.volume.findIndex((d) => d.time === lastT);
      for (const d of data.volume.slice(Math.max(vt, 0))) s.vol?.update(toVol(d));
    }
    shown.current = data;
  }, [data]);

  useEffect(() => {
    const el = host.current;
    if (!el || !hasData) return;
    const c = themeColors();
    const chart = createChart(el, {
      width: el.clientWidth,
      height: HEIGHT,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c.fg },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: c.border },
      timeScale: { borderColor: c.border, timeVisible: true, secondsVisible: false },
    });
    const candleSeries = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
    });
    candleSeries.setData(data.candles.map((d) => ({ ...d, time: d.time as UTCTimestamp })));
    let vol: ISeriesApi<"Histogram"> | undefined;
    if (data.volume.length) {
      vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "" });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(data.volume.map(toVol));
    }
    chart.timeScale().fitContent();
    series.current = { candle: candleSeries, vol };
    shown.current = data;

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    // Re-theme when the app toggles data-theme.
    const mo = new MutationObserver(() => {
      const t = themeColors();
      chart.applyOptions({
        layout: { textColor: t.fg },
        grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
        rightPriceScale: { borderColor: t.border },
        timeScale: { borderColor: t.border },
      });
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
      series.current = null;
      chart.remove();
    };
    // The chart is created once; later data goes through the update effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData]);

  if (!hasData) return <p className="text-xs text-zinc-400">No candles to chart.</p>;
  return <div ref={host} className="w-full min-w-0" style={{ height: HEIGHT }} role="img" aria-label={`Candlestick chart, ${data.candles.length} candles, last close ${data.candles.at(-1)?.close}`} />;
}
