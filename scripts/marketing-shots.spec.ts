// Captures the screenshots on the public marketing pages: `npm run marketing:shots`.
// Same sanity server, throwaway DB (prisma/sanity.db) and Playwright setup as e2e/, but outside the e2e testDir so
// `npm run sanity` never runs it. Chats are seeded through the API; where a real reply would need a live model the
// reply is stubbed into the conversation response (the pattern e2e/live-charts.spec.ts uses). Output: public/marketing/<slug>.webp.
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import sharp from "sharp";

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "public/marketing");
const DB = path.join(ROOT, "prisma/sanity.db");
const MAX_BYTES = 140 * 1024;

type Model = { id: string; name: string; provider: string; contextWindow: number };
const SONNET: Model = { id: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5", provider: "Anthropic", contextWindow: 200000 };
const MODELS: Model[] = [
  SONNET,
  { id: "openai/gpt-4o", name: "GPT-4o", provider: "OpenAI", contextWindow: 128000 },
  { id: "ollama/llama3.2:3b", name: "llama3.2:3b", provider: "Ollama", contextWindow: 131072 },
  { id: "ollama/qwen2.5-coder:7b", name: "qwen2.5-coder:7b", provider: "Ollama", contextWindow: 32768 },
  { id: "ollama/mistral:7b", name: "mistral:7b", provider: "Ollama", contextWindow: 32768 },
  { id: "ollama/gemma2:9b", name: "gemma2:9b", provider: "Ollama", contextWindow: 8192 },
  { id: "lmstudio/qwen2.5-7b-instruct", name: "qwen2.5-7b-instruct", provider: "LM Studio", contextWindow: 32768 },
];
const LLAMA = MODELS.find((m) => m.id === "ollama/llama3.2:3b")!;

/** Resets the throwaway DB's data and signs in as a person with an ordinary name. Only ever touches sanity.db. */
async function signIn(page: Page) {
  expect(DB.endsWith("sanity.db")).toBe(true);
  await page.addInitScript(() => localStorage.setItem("vas:theme", "light"));
  const login = async () => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in as test user" }).click();
    await page.waitForURL("/");
  };
  await login();
  const db = new PrismaClient({ datasourceUrl: `file:${DB}` });
  try {
    await db.user.updateMany({ data: { name: "Maya Patel" } });
  } finally {
    await db.$disconnect();
  }
  await page.context().clearCookies();
  await login();
  const req = page.request;
  for (const c of (await (await req.get("/api/conversations")).json()) as Array<{ id: string }>) await req.delete(`/api/conversations/${c.id}`);
  for (const w of (await (await req.get("/api/workflows")).json()) as Array<{ id: string }>) await req.delete(`/api/workflows/${w.id}`);
  for (const t of (await (await req.get("/api/tables")).json()) as Array<{ id: string }>) await req.delete(`/api/tables/${t.id}`);
}

/** The model picker lists these instead of the mock models. */
async function stubModels(page: Page, models: Model[] = MODELS) {
  await page.route("**/api/models", (r) =>
    r.fulfill({ json: { models: models.map((m) => ({ ...m, supportsTools: true, supportsVision: false, supportsThinking: false })) } }),
  );
}

type Turn = { user: string; assistant: string; parts?: unknown[] };

/** Saves the turns (text only, as the messages route does) and shows the page the assistant parts in their place. */
async function seedChat(page: Page, request: APIRequestContext, title: string, model: Model, turns: Turn[]): Promise<string> {
  const made = await request.post("/api/conversations", { data: { title, model: model.id } });
  expect(made.status()).toBe(201);
  const id = (await made.json()).id as string;
  for (const t of turns) {
    expect((await request.post(`/api/conversations/${id}/messages`, { data: { role: "user", content: t.user } })).ok()).toBeTruthy();
    expect((await request.post(`/api/conversations/${id}/messages`, { data: { role: "assistant", content: t.assistant } })).ok()).toBeTruthy();
  }
  const partsByIndex = turns.map((t) => t.parts);
  await page.route(`**/api/conversations/${id}`, async (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    const json = await (await r.fetch()).json();
    let n = -1;
    json.messages = json.messages.map((m: { role: string }) => {
      if (m.role !== "assistant") return m;
      const parts = partsByIndex[++n];
      return parts ? { ...m, parts: JSON.stringify(parts) } : m;
    });
    return r.fulfill({ json });
  });
  return id;
}

/** Earlier chats, so the sidebar looks lived in. Created first, so the chat being shown is on top. */
async function earlierChats(request: APIRequestContext, model: Model = SONNET) {
  const rows: Array<[string, string, string]> = [
    ["sourdough starter help", "my starter smells like nail polish, is it dead?", "Not dead, just hungry. That smell means it has run out of food, so feed it and give it a few hours."],
    ["sql join vs subquery", "join or subquery for this report?", "A join is usually the simpler read here, and the database handles both well."],
    ["trip packing list", "packing list for 4 days in lisbon", "Light layers, comfortable shoes for the hills, a small umbrella and a charger that fits the local sockets."],
  ];
  for (const [title, user, assistant] of rows) {
    const id = (await (await request.post("/api/conversations", { data: { title, model: model.id } })).json()).id as string;
    await request.post(`/api/conversations/${id}/messages`, { data: { role: "user", content: user } });
    await request.post(`/api/conversations/${id}/messages`, { data: { role: "assistant", content: assistant } });
  }
}

async function open(page: Page, id: string) {
  await page.goto(`/c/${id}`);
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

const patch = (p: string, value: unknown) => ({ type: "data-spec", data: { type: "patch", patch: { op: "add", path: p, value } } });

/** Waits for fonts, moves the pointer away, takes a 2x desktop shot, and writes a WebP under 150 KB. */
async function shoot(page: Page, slug: string, clip?: { x: number; y: number; width: number; height: number }) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(1270, 790);
  await page.waitForTimeout(600);
  const png = await page.screenshot({ animations: "disabled", caret: "hide", clip });
  fs.mkdirSync(OUT, { recursive: true });
  const meta = await sharp(png).metadata();
  let width = meta.width!;
  let quality = 82;
  let out = await sharp(png).webp({ quality }).toBuffer();
  while (out.length > MAX_BYTES) {
    if (quality > 55) quality -= 5;
    else width = Math.round(width * 0.9);
    out = await sharp(png).resize({ width }).webp({ quality }).toBuffer();
  }
  fs.writeFileSync(path.join(OUT, `${slug}.webp`), out);
  const final = await sharp(out).metadata();
  console.log(`${slug}.webp ${final.width}x${final.height} ${(out.length / 1024).toFixed(0)} KB q${quality}`);
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("agents", async ({ page }) => {
  const request = page.request;
  await stubModels(page);
  await earlierChats(request);
  const approval = {
    type: "tool-createArtifact",
    toolCallId: "call-offsite",
    state: "approval-requested",
    input: {
      type: "document",
      title: "Offsite checklist",
      content: "# Offsite checklist\n\n- [ ] Book the venue\n- [ ] Send the agenda\n- [ ] Order lunch\n- [ ] Print name badges\n",
    },
    approval: { id: "approval-offsite" },
  };
  const text = "I'll write that up as a document you can keep editing. You have Confirm each change on, so I'm waiting for your OK before I add it.";
  const id = await seedChat(page, request, "offsite prep", SONNET, [
    { user: "make a checklist for the team offsite and save it as a doc", assistant: text, parts: [{ type: "text", text }, approval] },
  ]);
  await open(page, id);
  await page.getByRole("radiogroup", { name: "Conversation mode" }).first().getByRole("radio", { name: "Agent" }).click();
  const options = page.getByRole("button", { name: "Mode options" }).first();
  await options.click();
  await page.getByLabel("Confirm each change").first().check();
  await options.click();
  await expect(page.getByRole("group", { name: /Needs your OK/ })).toBeVisible();
  await shoot(page, "agents");
});

test("workflows", async ({ page }) => {
  const request = page.request;
  await stubModels(page);
  const made = await request.post("/api/workflows", { data: { template: "news", model: "mock/workflow" } });
  expect(made.ok()).toBe(true);
  const id = (await made.json()).id as string;
  const started = await request.post(`/api/workflows/${id}/runs`);
  expect(started.ok()).toBe(true);
  const { runId } = await started.json();
  await expect.poll(async () => (await (await request.get(`/api/workflow-runs/${runId}`)).json()).state, { timeout: 30_000 }).toBe("succeeded");
  // The list view: all seven cards stay readable (the canvas fits them in a row, too small to read in one frame).
  await page.addInitScript(() => localStorage.setItem("vas:workflowView", "list"));
  await page.goto(`/workflows/${id}`);
  await expect(page.getByRole("group", { name: "Post to a chat, Send to chat, Done" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await shoot(page, "workflows");
});

test("visuals", async ({ page }) => {
  const request = page.request;
  await stubModels(page);
  await earlierChats(request);
  // A repeatable price path around 97k, so the numbers in the reply are exactly the ones drawn.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  let price = 97_150;
  const t0 = Date.UTC(2026, 10, 27, 9, 0);
  const candles = Array.from({ length: 60 }, (_, i) => {
    const o = price;
    const c = Math.round((o + rnd() * 60 + (i < 35 ? 6 : -9)) * 10) / 10;
    const h = Math.round((Math.max(o, c) + Math.abs(rnd()) * 28) * 10) / 10;
    const l = Math.round((Math.min(o, c) - Math.abs(rnd()) * 28) * 10) / 10;
    price = c;
    return { t: t0 + i * 60_000, o, h, l, c };
  });
  const hi = Math.max(...candles.map((c) => c.h));
  const lo = Math.min(...candles.map((c) => c.l));
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  const text = `Here are the last 60 one-minute candles for BTC/USDT. The hour opened near ${fmt(candles[0].o)}, ranged from ${fmt(lo)} to ${fmt(hi)}, and the latest close is ${fmt(candles[59].c)}.`;
  const id = await seedChat(page, request, "btc 1m candles", SONNET, [{ user: "btc 1m candles", assistant: text }]);
  const art = await request.post(`/api/conversations/${id}/artifacts`, {
    data: { type: "data", title: "BTCUSDT 1m", content: JSON.stringify({ orrery: 1, type: "ohlc", symbol: "BTCUSDT", interval: "1m", candles }) },
  });
  expect(art.ok()).toBeTruthy();
  const artifactId = (await art.json()).id as string;
  const parts = [{ type: "text", text }, patch("/root", "c"), patch("/elements/c", { type: "CandleChart", props: { dataArtifactId: artifactId }, children: [] })];
  await page.unroute(`**/api/conversations/${id}`);
  await page.route(`**/api/conversations/${id}`, async (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    const json = await (await r.fetch()).json();
    json.messages = json.messages.map((m: { role: string }) => (m.role === "assistant" ? { ...m, parts: JSON.stringify(parts) } : m));
    return r.fulfill({ json });
  });
  await open(page, id);
  await expect(page.getByRole("img", { name: /^Candlestick chart/ })).toBeVisible();
  await shoot(page, "visuals");
});

test("study", async ({ page }) => {
  const request = page.request;
  await stubModels(page);
  await earlierChats(request);
  const reply = [
    "Cells divide in a loop called the cell cycle. Most of it is preparation, and the actual split is short.",
    "```mermaid\nflowchart LR\n  G1[G1: grow] --> S[S: copy DNA]\n  S --> G2[G2: check]\n  G2 --> M[Mitosis: split DNA]\n  M --> C[Cytokinesis: split cell]\n  C --> G1\n```",
    "Each daughter cell ends up with the same DNA as the original, then starts the loop again.",
  ].join("\n\n");
  const id = await seedChat(page, request, "cell division", SONNET, [{ user: "explain how cells divide, with a diagram", assistant: reply }]);
  await open(page, id);
  await expect(page.getByRole("img", { name: "Flowchart diagram" }).locator("svg")).toBeVisible();
  await shoot(page, "study");
});

test("research", async ({ page }) => {
  const request = page.request;
  await stubModels(page);
  await earlierChats(request);
  const url = "https://www.sqlite.org/whentouse.html";
  const text = [
    "Short version: SQLite is great when the database lives next to the app, and a poor fit when many machines need to write to it at once.",
    "**Good fit**\n- apps and devices that keep their own data locally\n- websites with low to medium traffic\n- analysis and test data on one machine",
    "**Bad idea**\n- many clients writing over a network (it is not a client/server database)\n- very high write concurrency\n- datasets too big for one machine's disk",
    `Source: [sqlite.org, appropriate uses for SQLite](${url})`,
  ].join("\n\n");
  const fetched = {
    type: "tool-fetchUrl",
    toolCallId: "call-fetch",
    state: "output-available",
    input: { url },
    output: "Appropriate Uses For SQLite\n\nSQLite is not directly comparable to client/server SQL database engines such as MySQL, Oracle, PostgreSQL, or SQL Server since SQLite is trying to solve a different problem.",
  };
  const id = await seedChat(page, request, "when is sqlite a bad idea", SONNET, [
    {
      user: `can you read this and tell me when sqlite is a bad idea? ${url}`,
      assistant: text,
      parts: [fetched, { type: "text", text }],
    },
  ]);
  await open(page, id);
  await expect(page.getByText("Tool: fetchUrl")).toBeVisible();
  await shoot(page, "research");
});

test("local-models", async ({ page }) => {
  const request = page.request;
  await stubModels(page);
  await earlierChats(request, LLAMA);
  const text = "Here are three ideas:\n\n1. **Leaf & Co.**\n2. **The Potted Fern**\n3. **Green Corner**\n\nWant me to check how each one would look as a shop sign?";
  const id = await seedChat(page, request, "plant shop names", LLAMA, [{ user: "give me 3 name ideas for a small plant shop", assistant: text }]);
  await open(page, id);
  await page.getByRole("button", { name: /llama3\.2:3b/ }).first().click();
  await expect(page.getByRole("button", { name: "Ollama" })).toBeVisible();
  await expect(page.getByText("mistral:7b").first()).toBeVisible();
  await shoot(page, "local-models");
});

test("apps", async ({ page }) => {
  const request = page.request;
  await stubModels(page);
  await earlierChats(request);
  const tool = (name: string, description: string) => ({ name, description, inputSchema: {}, readOnly: true });
  const mk = (id: string, name: string, host: string, description: string, goodFor: string, tools: ReturnType<typeof tool>[]) => ({
    id, name, baseUrl: `https://${host}`, description, goodFor, mcpUrl: `https://${host}/api/mcp`, auth: "orrery-jwt",
    capabilities: [], deepLinks: {}, permission: "read", manifestVersion: 1, approved: true, status: "ok", tools,
  });
  const list = [
    mk("trade", "Trade MVP", "trade.example.com", "Public market data", "Looking up prices and candles", [
      tool("get_klines", "Candlestick data for a symbol"), tool("get_ticker", "Latest price for a symbol"), tool("list_symbols", "Symbols that can be charted"),
    ]),
    mk("printpro3d", "Print Pro 3D", "printpro3d.example.com", "3D models for printing", "Finding printable models", [
      tool("find_models", "Search the model library"), tool("get_model_stl", "Return a model as an STL file"),
    ]),
  ];
  await page.route("**/api/apps?all=1", (r) => r.fulfill({ json: list }));
  await page.route("**/api/apps", (r) => r.fulfill({ json: list }));
  // A chat that used a connected app's tool, with the app in the sidebar. (Settings > Apps reads washed out in the
  // light theme, so the shot shows the apps in use instead.)
  const text = "BTC/USDT is at 97,163.30 right now, from Trade MVP's public market data.";
  const call = {
    type: "tool-app_trade_get_ticker",
    toolCallId: "call-ticker",
    state: "output-available",
    input: { symbol: "BTCUSDT" },
    output: JSON.stringify({ symbol: "BTCUSDT", price: "97163.30" }),
  };
  const id = await seedChat(page, request, "btc price check", SONNET, [
    { user: "what's btc at right now?", assistant: text, parts: [call, { type: "text", text }] },
  ]);
  await open(page, id);
  await expect(page.getByTestId("sidebar-apps").getByText("Trade MVP")).toBeVisible();
  await expect(page.getByText("Tool: app_trade_get_ticker")).toBeVisible();
  await shoot(page, "apps");
});
