import { describe, expect, it } from "vitest";
import { catalog } from "@/lib/generativeUi/catalog";
import { uiGuideText } from "@/lib/generativeUi/guide";
import {
  STL_MAX_BYTES, binaryStlTriangles, cleanSeries, downsample, goHref, modelUrl, parseOrreryArtifact, stlGuard, tableResultToData, toLwcData, volumeUpdate,
} from "@/lib/generativeUi/appData";
import { JOB_BACKOFF_CAP_MS, clampProgress, isTerminal, jobStatusUrl, pollDelay, timedOut, JOB_TIMEOUT_MS } from "@/lib/generativeUi/jobPoll";
import { buildLayout, formatValue, nearestIndex, niceTicks } from "@/lib/generativeUi/timeSeries";

const chart = catalog.data.components.Chart.props;
const nullsChart = { data: null, dataArtifactId: null, labelColumn: null, valueColumn: null, title: null };

describe("catalog: app components", () => {
  it("prompt and guide mention the new components", () => {
    for (const name of ["CandleChart", "Model3D", "JobCard"]) {
      expect(catalog.prompt()).toContain(name);
      expect(uiGuideText()).toContain(name);
    }
    expect(uiGuideText()).toContain("dataArtifactId");
  });
  it("old single-series Chart props still validate, area and series are new", () => {
    expect(chart.safeParse({ ...nullsChart, type: "line", data: [{ label: "a", value: 1 }] }).success).toBe(true);
    expect(chart.safeParse({ ...nullsChart, type: "area", series: [{ name: "s", points: [[1, 2]] }] }).success).toBe(true);
    expect(chart.safeParse({ ...nullsChart, type: "area", series: [{ name: "s", points: [[1]] }] }).success).toBe(false);
  });
  it("new components validate", () => {
    const c = catalog.data.components;
    expect(c.CandleChart.props.safeParse({ symbol: "BTC", interval: "1h", dataArtifactId: "a", candles: null }).success).toBe(true);
    expect(c.CandleChart.props.safeParse({ symbol: "BTC", interval: "1h", dataArtifactId: null, candles: [{ t: 1, o: 1, h: 2, l: 0, c: 1 }] }).success).toBe(true);
    expect(c.Model3D.props.safeParse({ appId: "printpro3d", file: "f.stl", title: null, openLink: null, appName: null }).success).toBe(true);
    expect(c.JobCard.props.safeParse({ appId: "x1", jobId: "j", statusTool: "status", title: null, pollMs: null }).success).toBe(true);
    expect(c.JobCard.props.safeParse({ appId: "x1" }).success).toBe(false);
  });
});

describe("appData adapters", () => {
  it("parses only valid OrreryResult artifacts", () => {
    const ts = { orrery: 1, type: "timeseries", series: [{ name: "a", points: [[1, 2]] }] };
    expect(parseOrreryArtifact(JSON.stringify(ts))?.type).toBe("timeseries");
    expect(parseOrreryArtifact(JSON.stringify({ columns: ["a"], rows: [[1]] }))).toBeNull();
    expect(parseOrreryArtifact("a,b\n1,2")).toBeNull();
    expect(parseOrreryArtifact("{bad")).toBeNull();
  });
  it("cleans, sorts and downsamples series", () => {
    const s = cleanSeries([{ name: "a", points: [[3, 1], [1, 1], [2, NaN]] }, { name: "empty", points: [] }]);
    expect(s).toEqual([{ name: "a", points: [[1, 1], [3, 1]] }]);
    const big = Array.from({ length: 1000 }, (_, i) => i);
    const d = downsample(big, 100);
    expect(d).toHaveLength(100);
    expect(d[0]).toBe(0);
    expect(d[99]).toBe(999);
  });
  it("converts candles to ascending unique UTC seconds with volume", () => {
    const d = toLwcData([
      { t: 2000, o: 1, h: 2, l: 0, c: 2, v: 5 },
      { t: 1000, o: 2, h: 3, l: 1, c: 1 },
      { t: 2500, o: 9, h: 9, l: 9, c: 9, v: 7 }, // same second as 2000: later wins
      { t: NaN, o: 1, h: 1, l: 1, c: 1 },
    ]);
    expect(d.candles.map((c) => c.time)).toEqual([1, 2]);
    expect(d.candles[1].open).toBe(9);
    expect(d.volume).toEqual([{ time: 2, value: 7, up: true }]);
  });
  it("converts a table result to data cells", () => {
    expect(tableResultToData({ orrery: 1, type: "table", columns: ["a"], rows: [[1], ["x"], [null], [{ k: 1 }]] }).rows).toEqual([[1], ["x"], [null], ['{"k":1}']]);
  });
  it("only builds same-origin model urls and go links", () => {
    expect(modelUrl({ appId: "printpro3d", file: "a b.stl" })).toBe("/api/apps/printpro3d/file?name=a%20b.stl");
    expect(modelUrl({ appId: "Bad/../", file: "x" })).toBeNull();
    expect(modelUrl({ url: "https://evil.com/x.stl" })).toBeNull();
    expect(modelUrl({ url: "//evil.com/api/apps/aa/file?x" })).toBeNull();
    expect(modelUrl({ url: "/api/apps/aa/file?name=x" })).toBe("/api/apps/aa/file?name=x");
    expect(goHref("printpro3d", "quote", { file: "f.stl" })).toBe("/api/apps/printpro3d/go?link=quote&params=%7B%22file%22%3A%22f.stl%22%7D");
    expect(goHref("../x", "quote")).toBeNull();
  });
  it("guards STL size and triangle count", () => {
    expect(stlGuard(1024)).toBeNull();
    expect(stlGuard(STL_MAX_BYTES + 1)).toMatch(/preview limit/);
    expect(stlGuard(1000, 600_000)).toMatch(/triangles/);
    const buf = new ArrayBuffer(84 + 2 * 50);
    new DataView(buf).setUint32(80, 2, true);
    expect(binaryStlTriangles(buf)).toBe(2);
    expect(binaryStlTriangles(new ArrayBuffer(10))).toBeUndefined();
    expect(binaryStlTriangles(new ArrayBuffer(200))).toBeUndefined();
  });
});

describe("job polling", () => {
  it("backs off from the base to the cap and never exceeds it", () => {
    const d = Array.from({ length: 12 }, (_, i) => pollDelay(i, 2000));
    expect(d.slice(0, 3)).toEqual([2000, 2000, 2000]);
    expect(d[3]).toBe(3000);
    expect(Math.max(...d)).toBe(JOB_BACKOFF_CAP_MS);
    expect(d).toEqual([...d].sort((a, b) => a - b));
  });
  it("defaults and floors pollMs", () => {
    expect(pollDelay(0)).toBe(2000);
    expect(pollDelay(0, 10)).toBe(500);
    expect(pollDelay(9, 8000)).toBe(8000);
  });
  it("stops on terminal states and after 10 minutes", () => {
    expect(isTerminal("done") && isTerminal("failed")).toBe(true);
    expect(isTerminal("running") || isTerminal("queued")).toBe(false);
    expect(timedOut(0, JOB_TIMEOUT_MS - 1)).toBe(false);
    expect(timedOut(0, JOB_TIMEOUT_MS)).toBe(true);
  });
  it("builds a safe status url and clamps progress", () => {
    expect(jobStatusUrl("printpro3d", "j/1", "get status")).toBe("/api/apps/printpro3d/jobs/j%2F1?tool=get%20status");
    expect(jobStatusUrl("../x", "j", "t")).toBeNull();
    expect(clampProgress(150)).toBe(100);
    expect(clampProgress(-5)).toBe(0);
    expect(clampProgress(undefined)).toBeNull();
  });
});

describe("time series layout", () => {
  it("maps the data extent onto the box", () => {
    const L = buildLayout([{ name: "a", points: [[1000, 10], [2000, 20]] }, { name: "b", points: [[1500, 30]] }], { left: 10, top: 0, width: 100, height: 50 }, false);
    expect(L.x(1000)).toBe(10);
    expect(L.x(2000)).toBe(110);
    expect(L.y(L.yMax)).toBeCloseTo(0);
    expect(L.y(L.yMin)).toBeCloseTo(50);
    expect(L.yMin).toBeLessThanOrEqual(10);
    expect(L.yMax).toBeGreaterThanOrEqual(30);
  });
  it("handles a flat series and an area baseline at zero", () => {
    const L = buildLayout([{ name: "a", points: [[1, 5], [2, 5]] }], { left: 0, top: 0, width: 10, height: 10 }, true);
    expect(L.yMin).toBe(0);
    expect(Number.isFinite(L.y(5))).toBe(true);
  });
  it("finds nearest indexes and nice ticks", () => {
    expect(nearestIndex([10, 20, 30], 26)).toBe(2);
    expect(nearestIndex([10, 20, 30], 14)).toBe(0);
    expect(nearestIndex([10], 99)).toBe(0);
    expect(niceTicks(0, 100, 4)).toEqual([0, 50, 100]);
    expect(formatValue(12345.6)).toBe((12346).toLocaleString());
  });
});

describe("volumeUpdate", () => {
  const v = (...t: number[]) => t.map((time) => ({ time, value: 1, up: true }));
  it("sends only bars at or after the last volume bar shown, never older ones", () => {
    expect(volumeUpdate(v(1, 2, 3), v(1, 2, 3, 4))).toEqual({ set: false, bars: v(3, 4) });
    expect(volumeUpdate(v(1, 2), v(1, 2, 3, 4, 5))).toEqual({ set: false, bars: v(2, 3, 4, 5) });
  });
  it("sets the whole series when no volume was shown yet", () => {
    expect(volumeUpdate([], v(1, 2))).toEqual({ set: true, bars: v(1, 2) });
  });
});
