import { test, expect, type APIRequestContext, type Page } from "./fixtures";
import { deleteAllChats } from "./helpers";

// Google Sheets sync. No real Google call is possible: the sign-in "consent screen" is the callback itself and the
// token and Sheets calls are answered in-process by src/lib/google/fake.ts (sanity mode only). /api/integrations/google/test
// ages the fake's tokens and reads back the sheets it holds.

type FakeSheet = { id: string; title: string; values: string[][]; raw: boolean };
const fake = async (request: APIRequestContext, body: Record<string, unknown> = {}): Promise<FakeSheet[]> => {
  const res = await request.post("/api/integrations/google/test", { data: body });
  expect(res.ok()).toBe(true);
  return (await res.json()).sheets;
};

async function reset(request: APIRequestContext) {
  for (const w of (await (await request.get("/api/workflows")).json()) as Array<{ id: string }>) await request.delete(`/api/workflows/${w.id}`);
  for (const t of (await (await request.get("/api/tables")).json()) as Array<{ id: string }>) await request.delete(`/api/tables/${t.id}`);
  await deleteAllChats(request);
  await request.delete("/api/integrations/google");
  await fake(request, { reset: true });
}

/** The News workflow run once: the News table holds the three fixture articles. Returns the table id. */
async function seed(request: APIRequestContext): Promise<string> {
  const made = await request.post("/api/workflows", { data: { template: "news", model: "mock/workflow" } });
  expect(made.status()).toBe(201);
  const { runId } = await (await request.post(`/api/workflows/${(await made.json()).id}/runs`)).json();
  await expect.poll(async () => (await (await request.get(`/api/workflow-runs/${runId}`)).json()).state, { timeout: 30_000 }).toBe("succeeded");
  const tables: Array<{ id: string; name: string }> = await (await request.get("/api/tables")).json();
  return tables.find((t) => t.name === "News")!.id;
}

/** Fails the test if the browser ever heads for Google: the sign-in must stay on this server. */
function noGoogleInBrowser(page: Page) {
  return page.route(/^https:\/\/(accounts|oauth2|sheets|docs)\.google(apis)?\.com\//, (r) => {
    throw new Error(`the browser went to ${r.request().url()}`);
  });
}

const syncButton = (page: Page) => page.getByRole("button", { name: "Sync to Google Sheets" });
const openSheet = (page: Page) => page.getByRole("link", { name: "Open sheet" });

test.beforeEach(async ({ request }) => reset(request));
test.afterEach(async ({ request }) => reset(request));

test("connect, sync, Open sheet, then a re-sync overwrites the same sheet", async ({ page, request }) => {
  await noGoogleInBrowser(page);
  const id = await seed(request);
  await page.goto(`/tables/${id}`);
  await expect(page.getByRole("heading", { name: "News" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(openSheet(page)).toHaveCount(0);

  // Not connected: one press goes through Google's consent, comes back, and finishes the sync.
  await syncButton(page).click();
  await expect(page.getByText("Synced 3 rows to Google Sheets").last()).toBeVisible();
  await expect(openSheet(page)).toBeVisible();
  await expect(openSheet(page)).toHaveAttribute("href", /^https:\/\/docs\.google\.com\/spreadsheets\/d\/fake-sheet-\d+\/edit$/);
  await expect(openSheet(page)).toHaveAttribute("rel", /noopener/);
  await expect(page).toHaveURL(new RegExp(`/tables/${id}$`)); // the ?google= flags are gone

  let sheets = await fake(request);
  expect(sheets).toHaveLength(1);
  expect(sheets[0]).toMatchObject({ title: "News", raw: true });
  expect(sheets[0].values).toHaveLength(4); // header + 3 rows
  expect(sheets[0].values[0]).toEqual(["Title", "URL", "Snippet", "Query", "Status"]);
  const firstSheet = sheets[0].id;

  // The page reloaded later still offers the sheet (the id is saved on the table).
  await page.reload();
  await expect(openSheet(page)).toBeVisible();

  // Delete a row, sync again: the same sheet now holds the smaller table.
  const rows = (await (await request.get(`/api/tables/${id}/rows`)).json()).rows as Array<{ id: string }>;
  expect((await request.delete(`/api/tables/${id}/rows`, { data: { ids: [rows[0].id] } })).ok()).toBe(true);
  await page.reload();
  await syncButton(page).click();
  await expect(page.getByText("Synced 2 rows to Google Sheets").last()).toBeVisible();
  sheets = await fake(request);
  expect(sheets).toHaveLength(1);
  expect(sheets[0].id).toBe(firstSheet);
  expect(sheets[0].values).toHaveLength(3);
});

test("an expired access token is refreshed quietly and the sync goes through", async ({ page, request }) => {
  const id = await seed(request);
  await page.goto(`/tables/${id}`);
  await page.waitForLoadState("networkidle");
  await syncButton(page).click();
  await expect(openSheet(page)).toBeVisible();
  await fake(request, { expireAccess: true });
  await syncButton(page).click();
  await expect(page.getByText("Synced 3 rows to Google Sheets").last()).toBeVisible();
  expect((await fake(request))[0].values).toHaveLength(4);
});

test("when Google refuses the refresh the page says Reconnect Google, and reconnecting finishes the sync", async ({ page, request }) => {
  const id = await seed(request);
  await page.goto(`/tables/${id}`);
  await page.waitForLoadState("networkidle");
  await syncButton(page).click();
  await expect(openSheet(page)).toBeVisible();

  await fake(request, { expireAccess: true, failRefresh: true });
  await syncButton(page).click();
  await expect(page.getByText("Google access ended. Reconnect Google, then try again.").last()).toBeVisible();
  await expect(page.getByRole("link", { name: "Reconnect Google" })).toBeVisible();
  await expect(syncButton(page)).toHaveCount(0);
  expect(await (await request.get("/api/integrations/google")).json()).toMatchObject({ connected: false, reconnect: true });
  // no raw error, no stack, no token in the page
  await expect(page.getByText(/invalid_grant|fake-access|fake-refresh|Bearer/)).toHaveCount(0);

  // Settings says the same thing
  await page.goto("/settings");
  await expect(page.getByText("Google access ended.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Reconnect Google" })).toBeVisible();

  // Reconnect (the fake works again): back on the table, the sync finishes.
  await fake(request, { failRefresh: false });
  await page.goto(`/tables/${id}`);
  await page.getByRole("link", { name: "Reconnect Google" }).click();
  await expect(page.getByText("Synced 3 rows to Google Sheets").last()).toBeVisible();
  await expect(syncButton(page)).toBeVisible();
  expect(await (await request.get("/api/integrations/google")).json()).toMatchObject({ connected: true, reconnect: false });
});

test("Settings shows the connection; Disconnect deletes the tokens, and no token ever reaches the browser", async ({ page, request }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Google Sheets" })).toBeVisible();
  await expect(page.getByText("Google isn't connected.")).toBeVisible();
  await page.getByRole("link", { name: "Connect Google" }).click();
  await expect(page).toHaveURL(/\/settings\?google=connected$/);
  await expect(page.getByText("Google is connected.")).toBeVisible();
  const state = await (await request.get("/api/integrations/google")).json();
  expect(state).toEqual({ configured: true, connected: true, reconnect: false });
  // the state cookie is gone, and no cookie holds a token
  const cookies = await page.context().cookies();
  expect(cookies.some((c) => c.name === "devchat_google_state")).toBe(false);
  expect(JSON.stringify(cookies)).not.toMatch(/fake-access|fake-refresh/);
  expect(JSON.stringify(await (await request.get("/api/settings/keys")).json())).not.toMatch(/fake-access|fake-refresh|googleSheetsTokens/);

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("Google isn't connected.")).toBeVisible();
  expect(await (await request.get("/api/integrations/google")).json()).toMatchObject({ connected: false, reconnect: false });
});

test("the callback refuses a bad or missing state", async ({ request }) => {
  const res = await request.get("/api/integrations/google/callback?code=sanity-code&state=nope", { maxRedirects: 0 });
  expect(res.status()).toBe(400);
  expect(await (await request.get("/api/integrations/google")).json()).toMatchObject({ connected: false });
});

test("a workflow's Sync to Google Sheet card: its settings show the connection, and a run syncs the table", async ({ page, request }) => {
  const tableId = await seed(request);
  const made = await request.post("/api/workflows", { data: { template: "blank", model: "mock/workflow" } });
  const wf = await made.json();
  const graph = (await (await request.get(`/api/workflows/${wf.id}`)).json()).graph;
  graph.nodes.push({ id: "push", type: "sheetSync", fromIds: ["trigger"], config: { tableId }, ui: { label: "Push", position: { x: 340, y: 0 } } });
  expect((await request.patch(`/api/workflows/${wf.id}`, { data: { graph } })).ok()).toBe(true);

  // not connected: the settings say so, and Run refuses with a plain reason
  await page.goto(`/workflows/${wf.id}`);
  await expect(page.getByRole("region", { name: "Workflow canvas" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("group", { name: "Push, Sync to Google Sheet, Not run" }).click();
  await expect(page.getByTestId("google-status")).toContainText("Google isn't connected.");
  await expect(page.getByRole("link", { name: "Connect in Settings" })).toBeVisible();
  const refused = await request.post(`/api/workflows/${wf.id}/runs`);
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toBe("Push: Connect Google in Settings first");

  await page.goto("/settings");
  await page.getByRole("link", { name: "Connect Google" }).click();
  await expect(page.getByText("Google is connected.")).toBeVisible();

  await page.goto(`/workflows/${wf.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("group", { name: "Push, Sync to Google Sheet, Not run" }).click();
  await expect(page.getByTestId("google-status")).toContainText("Google is connected.");
  const { runId } = await (await request.post(`/api/workflows/${wf.id}/runs`)).json();
  await expect.poll(async () => (await (await request.get(`/api/workflow-runs/${runId}`)).json()).state, { timeout: 30_000 }).toBe("succeeded");
  const sheets = await fake(request);
  expect(sheets).toHaveLength(1);
  expect(sheets[0].values).toHaveLength(4);
  // the sheet link is on the table too
  expect((await (await request.get(`/api/tables/${tableId}`)).json()).sheetUrl).toContain(sheets[0].id);
});

for (const theme of ["dark", "light"] as const) {
  test(`table header with the sync button and Open sheet, ${theme}`, async ({ page, request }) => {
    await page.addInitScript((t) => localStorage.setItem("vas:theme", t), theme);
    const id = await seed(request);
    await page.goto(`/tables/${id}`);
    await page.waitForLoadState("networkidle");
    await syncButton(page).click();
    await expect(openSheet(page)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(2, 2);
    // the toast is a moving target: wait it out, then take the header only
    await expect(page.getByText("Synced 3 rows to Google Sheets")).toHaveCount(0, { timeout: 15_000 });
    const header = page.locator("main > div > div").first();
    await expect(header).toHaveScreenshot(`table-header-synced-${theme}.png`);
  });
}
