import { readFile } from "node:fs/promises";
import { test, expect, type APIRequestContext, type Page } from "./fixtures";
import { deleteAllChats } from "./helpers";

// The News template against the fixture search (e2e/fixtures/workflows/search.json): 3 results, the same on every run.
const TITLES = ["Open-source coding agent ships plugin API", "Local LLM runtime adds speculative decoding", "New benchmark compares tool-calling models"];

async function reset(request: APIRequestContext) {
  for (const w of (await (await request.get("/api/workflows")).json()) as Array<{ id: string }>) await request.delete(`/api/workflows/${w.id}`);
  for (const t of (await (await request.get("/api/tables")).json()) as Array<{ id: string }>) await request.delete(`/api/tables/${t.id}`);
  await deleteAllChats(request);
}

async function createNews(request: APIRequestContext): Promise<string> {
  const res = await request.post("/api/workflows", { data: { template: "news", model: "mock/workflow" } });
  expect(res.status()).toBe(201);
  return (await res.json()).id;
}

/** Starts a run and waits for it to succeed. */
async function runToEnd(request: APIRequestContext, workflowId: string): Promise<string> {
  const res = await request.post(`/api/workflows/${workflowId}/runs`);
  expect(res.status()).toBe(202);
  const { runId } = await res.json();
  await expect.poll(async () => (await (await request.get(`/api/workflow-runs/${runId}`)).json()).state, { timeout: 30_000 }).toBe("succeeded");
  return runId;
}

async function newsTable(request: APIRequestContext) {
  const tables: Array<{ id: string; name: string; rowCount: number }> = await (await request.get("/api/tables")).json();
  const t = tables.find((x) => x.name === "News");
  expect(t, "the News table").toBeTruthy();
  return t!;
}

const rowsOf = async (request: APIRequestContext, tableId: string, query = "") =>
  (await (await request.get(`/api/tables/${tableId}/rows${query}`)).json()).rows as Array<{ id: string; status: string; data: Record<string, string> }>;

const card = (page: Page, label: string, type: string, status: string) => page.getByRole("group", { name: `${label}, ${type}, ${status}` });

/** A News table with its three rows, and the page open on it. */
async function openFilledTable(page: Page, request: APIRequestContext): Promise<string> {
  await reset(request);
  await runToEnd(request, await createNews(request));
  const table = await newsTable(request);
  await page.goto(`/tables/${table.id}`);
  await expect(page.getByRole("heading", { name: "News" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("checkbox", { name: `Select ${TITLES[0]}` })).toBeVisible();
  await page.waitForLoadState("networkidle");
  return table.id;
}

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test("running News twice leaves no duplicates, and the second run stops at the Filter", async ({ page, request }) => {
  const id = await createNews(request);
  const first = await runToEnd(request, id);
  const table = await newsTable(request);
  expect(table.rowCount).toBe(3);
  // The flow posted the digest, so its last card marked the three rows read.
  expect((await rowsOf(request, table.id)).map((r) => r.status)).toEqual(["read", "read", "read"]);
  const chatsAfterFirst = (await (await request.get("/api/conversations")).json()).length;
  expect(chatsAfterFirst).toBe(1);
  expect((await (await request.get(`/api/workflow-runs/${first}?node=fresh`)).json()).output.count).toBe(3);

  const second = await runToEnd(request, id);
  expect((await newsTable(request)).rowCount).toBe(3);
  const save = (await (await request.get(`/api/workflow-runs/${second}?node=save`)).json()).output;
  expect(save.inserted).toEqual([]);
  expect(save.updated).toHaveLength(3);
  expect((await (await request.get("/api/conversations")).json()).length).toBe(chatsAfterFirst); // no second digest

  await page.goto(`/workflows/${id}`);
  await expect(card(page, "New articles", "Filter", "Done")).toBeVisible();
  await expect(card(page, "Write the digest", "Agent", "Skipped")).toBeVisible();
  await expect(card(page, "Post to a chat", "Send to chat", "Skipped")).toBeVisible();
  await expect(page.getByText("Nothing left after New articles").first()).toBeVisible();
});

test("the table list and the table view show what the run saved", async ({ page, request }) => {
  await page.goto("/tables");
  await expect(page.getByText("No tables yet. A workflow's Save to table card creates one.")).toBeVisible();

  await runToEnd(request, await createNews(request));
  await page.goto("/tables");
  const row = page.getByRole("listitem").filter({ hasText: "News" });
  await expect(row).toContainText("3 rows");
  await row.getByRole("link", { name: "News" }).click();

  await expect(page.getByRole("heading", { name: "News" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("3 rows", { exact: true })).toBeVisible();
  for (const title of TITLES) await expect(page.getByRole("button", { name: title })).toBeVisible();
  const first = page.getByRole("row").filter({ hasText: TITLES[0] });
  await expect(first.getByRole("link", { name: /news\.example\.test\/coding-agent-plugins/ })).toHaveAttribute("rel", "noopener noreferrer");
  await expect(first.getByLabel(`Status of ${TITLES[0]}`)).toHaveValue("read");

  await page.getByLabel("Search rows").fill("speculative");
  await expect(page.getByRole("button", { name: TITLES[1] })).toBeVisible();
  await expect(page.getByRole("button", { name: TITLES[0] })).toHaveCount(0);
  await page.getByLabel("Search rows").fill("zzz-no-match");
  await expect(page.getByText("No rows match.")).toBeVisible();
});

test("a row opens in a drawer with every field and a Copy button on each", async ({ page, request }) => {
  await openFilledTable(page, request);
  await page.getByRole("button", { name: TITLES[0], exact: true }).click();
  const drawer = page.getByRole("complementary");
  await expect(drawer.getByRole("heading", { name: TITLES[0] })).toBeVisible();
  for (const field of ["Title", "URL", "Snippet", "Query"]) await expect(drawer.getByRole("heading", { name: field, exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Copy Snippet" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "https://news.example.test/coding-agent-plugins" })).toHaveAttribute("target", "_blank");
  await expect(drawer.getByText("Status: read")).toBeVisible();
});

test("Export CSV downloads the header and the rows", async ({ page, request }) => {
  const id = await openFilledTable(page, request);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
  expect(download.suggestedFilename()).toBe("News.csv");
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv.charCodeAt(0)).toBe(0xfeff); // a byte order mark, for Excel
  const lines = csv.slice(1).trimEnd().split("\r\n");
  expect(lines[0]).toBe("Title,URL,Snippet,Query,Status");
  expect(lines).toHaveLength(4);
  for (const url of ["coding-agent-plugins", "local-llm-speculative", "tool-calling-benchmark"]) expect(csv).toContain(`https://news.example.test/${url}`);
  expect(lines.slice(1).every((l) => l.endsWith(",read"))).toBe(true);

  const res = await request.get(`/api/tables/${id}/export`);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(res.headers()["content-disposition"]).toContain('attachment; filename="News.csv"');
  expect(await res.text()).toBe(csv);
});

test("a bulk status change updates the ticked rows, and the status filter finds them", async ({ page, request }) => {
  const id = await openFilledTable(page, request);
  await page.getByRole("checkbox", { name: `Select ${TITLES[0]}` }).check();
  await page.getByRole("checkbox", { name: `Select ${TITLES[2]}` }).check();
  await page.getByLabel("Set status of 2 selected").selectOption("new");

  await expect(page.getByLabel(`Status of ${TITLES[0]}`)).toHaveValue("new");
  await expect(page.getByLabel(`Status of ${TITLES[2]}`)).toHaveValue("new");
  await expect(page.getByLabel(`Status of ${TITLES[1]}`)).toHaveValue("read");
  const byTitle = Object.fromEntries((await rowsOf(request, id)).map((r) => [r.data.title, r.status]));
  expect(byTitle).toEqual({ [TITLES[0]]: "new", [TITLES[1]]: "read", [TITLES[2]]: "new" });

  await page.getByLabel("Filter by status").selectOption("new");
  await expect(page.getByRole("button", { name: TITLES[1] })).toHaveCount(0);
  await expect(page.getByRole("button", { name: TITLES[0] })).toBeVisible();

  // A change to a status the table does not offer is refused.
  const bad = await request.patch(`/api/tables/${id}/rows`, { data: { ids: [(await rowsOf(request, id))[0].id], status: "bogus" } });
  expect(bad.status()).toBe(400);
});

test("Delete asks first, then removes the ticked rows", async ({ page, request }) => {
  const id = await openFilledTable(page, request);
  await page.getByRole("checkbox", { name: `Select ${TITLES[1]}` }).check();
  page.once("dialog", (d) => {
    expect(d.message()).toBe("Delete 1 row? This can't be undone.");
    void d.dismiss();
  });
  await page.getByRole("button", { name: "Delete" }).click();
  expect(await rowsOf(request, id)).toHaveLength(3);

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: TITLES[1] })).toHaveCount(0);
  await expect(page.getByText("2 rows", { exact: true })).toBeVisible();
  expect(await rowsOf(request, id)).toHaveLength(2);
});

test("the table API keeps tables apart by name, checks input and 404s on a missing table", async ({ request }) => {
  const made = await request.post("/api/tables", { data: { name: "Leads" } });
  expect(made.status()).toBe(201);
  const { id } = await made.json();
  expect((await request.post("/api/tables", { data: { name: "Leads" } })).status()).toBe(409);
  expect((await request.post("/api/tables", { data: { name: "  " } })).status()).toBe(400);
  expect(await (await request.get(`/api/tables/${id}`)).json()).toMatchObject({ name: "Leads", statuses: ["new"], columns: [], rowCount: 0 });
  expect((await request.patch(`/api/tables/${id}`, { data: { name: "Leads 2", statuses: ["new", "applied"] } })).ok()).toBe(true);
  expect((await request.patch(`/api/tables/${id}`, { data: { columns: [{ key: "a" }] } })).status()).toBe(400);
  expect((await request.get("/api/tables/nope")).status()).toBe(404);
  expect((await request.get("/api/tables/nope/rows")).status()).toBe(404);
  expect((await request.get("/api/tables/nope/export")).status()).toBe(404);
  expect((await request.delete(`/api/tables/${id}`)).ok()).toBe(true);
  expect((await request.get(`/api/tables/${id}`)).status()).toBe(404);
});

test("a Save to table card pointing at a deleted table stops the run before it starts", async ({ request }) => {
  const id = await createNews(request);
  await request.delete(`/api/tables/${(await newsTable(request)).id}`);
  const res = await request.post(`/api/workflows/${id}/runs`);
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toContain("that table no longer exists");
});

test("at 400px the grid scrolls inside its own box, not the page", async ({ page, request }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await openFilledTable(page, request);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const box = page.locator("table").locator("xpath=..");
  expect(await box.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(page.getByRole("checkbox", { name: `Select ${TITLES[0]}` })).toBeInViewport({ ratio: 1 });
  // The sticky columns leave room: the Status select is on screen, and it is the element under its own centre (not covered).
  const status = page.getByLabel(`Status of ${TITLES[0]}`);
  await expect(status).toBeInViewport({ ratio: 1 });
  expect(await status.evaluate((el) => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el; })).toBe(true);
  // After scrolling the grid to its end the last column is reachable, still with the first column in view.
  await box.evaluate((el) => (el.scrollLeft = el.scrollWidth));
  await expect(page.getByRole("checkbox", { name: `Select ${TITLES[0]}` })).toBeInViewport({ ratio: 1 });
  expect(await box.evaluate((el) => el.scrollLeft + el.clientWidth >= el.scrollWidth - 1)).toBe(true);
  // A 400px grid is not covered by its sticky cells: the first column is at most 10rem wide.
  expect(await page.getByRole("button", { name: TITLES[0], exact: true }).evaluate((el) => el.closest("td")!.getBoundingClientRect().width)).toBeLessThanOrEqual(161);
  // Touch targets: the tick, the status select.
  for (const box of [await page.getByRole("checkbox", { name: `Select ${TITLES[0]}` }).locator("xpath=..").boundingBox(), await status.boundingBox()]) expect(box!.height).toBeGreaterThanOrEqual(32);
});

test("the editor sets the table of a Save card and the rules of a Filter, and the run follows them", async ({ page, request }) => {
  const id = await createNews(request);
  await page.goto(`/workflows/${id}`);
  await expect(page.getByLabel("Workflow name")).toBeVisible();
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Open settings for Save to the News table" }).click();
  await expect(page.getByLabel("Table", { exact: true })).toHaveValue((await newsTable(request)).id);
  page.once("dialog", (d) => void d.accept("Leads"));
  await page.getByLabel("Table", { exact: true }).selectOption("__new__");
  await expect(page.getByLabel("Table", { exact: true }).locator("option:checked")).toHaveText("Leads");

  await page.getByRole("button", { name: "Open settings for New articles" }).click();
  await page.getByRole("button", { name: "Add rule" }).click();
  // The template already keeps rows whose status is new; this is a second rule.
  await page.getByLabel("Rule field", { exact: true }).last().fill("{{item.title}}");
  await page.getByLabel("Rule test", { exact: true }).last().selectOption("contains");
  await page.getByLabel("Rule value", { exact: true }).last().fill("agent");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  const saved = (await (await request.get(`/api/workflows/${id}`)).json()).graph.nodes;
  const leads = ((await (await request.get("/api/tables")).json()) as Array<{ id: string; name: string }>).find((t) => t.name === "Leads")!;
  expect(saved.find((n: { id: string }) => n.id === "save").config.tableId).toBe(leads.id);
  expect(saved.find((n: { id: string }) => n.id === "fresh").config.rules).toEqual([
    { field: "{{item.status}}", op: "eq", value: "new" },
    { field: "{{item.title}}", op: "contains", value: "agent" },
  ]);

  const runId = await runToEnd(request, id);
  expect((await rowsOf(request, leads.id)).map((r) => r.data.title).sort()).toEqual([...TITLES].sort());
  const fresh = (await (await request.get(`/api/workflow-runs/${runId}?node=fresh`)).json()).output;
  expect(fresh).toMatchObject({ count: 1, removed: 2 });
  expect(fresh.items[0].title).toBe(TITLES[0]);
});

test("a table filled after a chat reader is private, and a later card that reaches the web is refused", async ({ page, request }) => {
  const table = await (await request.post("/api/tables", { data: { name: "Chat notes" } })).json();
  const blank = await (await request.post("/api/workflows", { data: { name: "Chat notes flow", model: "mock/workflow" } })).json();
  const { graph } = await (await request.get(`/api/workflows/${blank.id}`)).json();
  const node = (id: string, type: string, fromIds: string[], x: number, config: Record<string, unknown>) => ({ id, type, fromIds, config, ui: { label: id, position: { x, y: 0 } } });
  graph.nodes.push(
    node("read", "agent", ["trigger"], 280, { instructions: "List my chats", tools: ["searchChats"] }),
    node("keep", "table", ["read"], 560, { tableId: table.id, action: "upsert", list: "{{trigger.items}}", keyField: "url", fields: [], status: "" }),
  );
  expect((await request.patch(`/api/workflows/${blank.id}`, { data: { graph } })).ok()).toBe(true);
  const run = await request.post(`/api/workflows/${blank.id}/runs`);
  expect(run.status()).toBe(202); // the Save card then fails on its empty list; the table is marked either way
  await expect.poll(async () => (await (await request.get(`/api/workflow-runs/${(await run.json()).runId}`)).json()).state, { timeout: 30_000 }).not.toBe("running");
  expect((await (await request.get(`/api/tables/${table.id}`)).json()).private).toBe(true);

  await page.goto("/tables");
  await expect(page.getByRole("listitem").filter({ hasText: "Chat notes" }).getByText("Private", { exact: true })).toBeVisible();
  await page.goto(`/tables/${table.id}`);
  await expect(page.getByText("Private", { exact: true })).toBeVisible();
  await expect(page.getByText("Workflows can't send what is in it to the web.")).toBeVisible();

  // A flow that reads that table and then fetches a page is refused when it starts.
  const other = await (await request.post("/api/workflows", { data: { name: "Leaky", model: "mock/workflow" } })).json();
  const g2 = (await (await request.get(`/api/workflows/${other.id}`)).json()).graph;
  g2.nodes.push(
    node("again", "table", ["trigger"], 280, { tableId: table.id, action: "update", list: "{{trigger.items}}", keyField: "url", fields: [], status: "" }),
    node("page", "fetch", ["again"], 560, { url: "https://example.test", as: "page" }),
  );
  expect((await request.patch(`/api/workflows/${other.id}`, { data: { graph: g2 } })).ok()).toBe(true);
  const refused = await request.post(`/api/workflows/${other.id}/runs`);
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toContain("“Chat notes” holds private data (it was filled from chats, MCP or a folder)");
});
