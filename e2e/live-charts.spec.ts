import { test, expect } from "./fixtures";
import { createChat, openChat } from "./helpers";

const candle = (i: number, c = 1.5) => ({ t: 1_700_000_000_000 + i * 60_000, o: 1, h: 2, l: 0.5, c });
const ohlc = (n: number, last: number) => ({
  orrery: 1,
  type: "ohlc",
  symbol: "BTCUSDT",
  interval: "1m",
  candles: Array.from({ length: n }, (_, i) => candle(i, i === n - 1 ? last : 1.5)),
});

test("a live candle chart shows the Live badge, updates in place, and pauses", async ({ page, request }) => {
  const id = await createChat(request, { title: "Live chart" });
  const art = await request.post(`/api/conversations/${id}/artifacts`, {
    data: {
      type: "data",
      title: "BTCUSDT 1m",
      content: JSON.stringify({ ...ohlc(15, 1.5), app: "trade", refresh: { tool: "klines", args: { symbol: "BTCUSDT" }, everyMs: 2000 } }),
    },
  });
  expect(art.ok()).toBeTruthy();
  const artifactId = (await art.json()).id;
  const patch = (path: string, value: unknown) => ({ type: "data-spec", data: { type: "patch", patch: { op: "add", path, value } } });
  // The messages route stores text only (it drops `parts`), so the saved reply is text and the page is shown the
  // conversation as the server would return it for a reply that carried the chart spec.
  const seeded = await request.post(`/api/conversations/${id}/messages`, { data: { role: "assistant", content: "Here is the chart." } });
  expect(seeded.ok()).toBeTruthy();
  const parts = [
    { type: "text", text: "Here is the chart." },
    patch("/root", "c"),
    patch("/elements/c", { type: "CandleChart", props: { dataArtifactId: artifactId }, children: [] }),
  ];
  await page.route(`**/api/conversations/${id}`, async (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    const json = await (await r.fetch()).json();
    json.messages = json.messages.map((m: { role: string }) => (m.role === "assistant" ? { ...m, parts: JSON.stringify(parts) } : m));
    return r.fulfill({ json });
  });

  // Only Orrery's own app-result save keeps (and signs) `refresh`; the artifact API strips it from anything a client
  // or the model writes. So the page is shown the artifact as the server would return a signed one.
  await page.route(`**/api/artifacts/${artifactId}`, async (r) => {
    const json = await (await r.fetch()).json();
    const content = JSON.stringify({ ...JSON.parse(json.content), app: "trade", refresh: { tool: "klines", args: { symbol: "BTCUSDT" }, everyMs: 2000 } });
    return r.fulfill({ json: { ...json, content } });
  });

  let calls = 0;
  const bodies: unknown[] = [];
  await page.route("**/api/apps/refresh-result", (r) => {
    calls++;
    bodies.push(r.request().postDataJSON());
    return r.fulfill({ json: ohlc(16 + calls, 2.5) });
  });

  await openChat(page, id);
  const chart = page.getByRole("img", { name: /^Candlestick chart/ });
  await expect(chart).toHaveAccessibleName("Candlestick chart, 15 candles, last close 1.5");
  await expect(page.getByText("Live", { exact: true })).toBeVisible();

  // The stubbed refresh adds candles: the chart name changes without a reload.
  await expect(chart).toHaveAccessibleName(/last close 2\.5/);
  expect(bodies[0]).toEqual({ artifactId }); // only the id is sent: no tool, no args

  await page.getByRole("button", { name: "Pause live updates" }).click();
  await expect(page.getByRole("button", { name: "Resume live updates" })).toBeVisible();
  const paused = calls;
  await page.waitForTimeout(4500);
  expect(calls).toBe(paused);

  await page.getByRole("button", { name: "Resume live updates" }).click();
  await expect(page.getByRole("button", { name: "Pause live updates" })).toBeVisible();
  await expect.poll(() => calls, { timeout: 8000 }).toBeGreaterThan(paused);
});
