import { test, expect, type APIRequestContext, type Page } from "./fixtures";

// The Jobs template against the recorded board responses (e2e/fixtures/workflows/{greenhouse,ashby,lever}-*.json):
// no network, no real model. mock/workflow answers the Draft card's output fields ("mock coverLetter", …).
// Titles with "Engineer" in them, across the three fixtures: 3 + 3 + 3 jobs (the Greenhouse Account Executive,
// the Lever Account Executive and the unlisted Ashby Brand Designer are filtered out).
const FIRST = "Software Engineer - Branching";
const SECOND = "Performance Engineer - Benchmarking";

async function reset(request: APIRequestContext) {
  for (const w of (await (await request.get("/api/workflows")).json()) as Array<{ id: string }>) await request.delete(`/api/workflows/${w.id}`);
  for (const t of (await (await request.get("/api/tables")).json()) as Array<{ id: string }>) await request.delete(`/api/tables/${t.id}`);
}

/** A Jobs workflow reading all three boards, with the title filter widened to "Engineer". */
async function createJobs(request: APIRequestContext, tweak: (graph: { nodes: Array<{ id: string; config: Record<string, unknown> }> }) => void = () => {}): Promise<string> {
  const res = await request.post("/api/workflows", { data: { template: "jobs", model: "mock/workflow" } });
  expect(res.status()).toBe(201);
  const id = (await res.json()).id;
  const { graph } = await (await request.get(`/api/workflows/${id}`)).json();
  Object.assign(graph.nodes.find((n: { id: string }) => n.id === "jobs").config, {
    boards: "https://jobs.ashbyhq.com/supabase\nhttps://job-boards.greenhouse.io/vercel\nhttps://jobs.lever.co/spotify",
    titleInclude: "Engineer",
    titleExclude: "",
    locationAllow: "",
  });
  tweak(graph);
  expect((await request.patch(`/api/workflows/${id}`, { data: { graph } })).ok()).toBe(true);
  return id;
}

async function startRun(request: APIRequestContext, workflowId: string): Promise<string> {
  const res = await request.post(`/api/workflows/${workflowId}/runs`);
  expect(res.status()).toBe(202);
  return (await res.json()).runId;
}

const runState = async (request: APIRequestContext, runId: string): Promise<string> => (await (await request.get(`/api/workflow-runs/${runId}`)).json()).state;
const card = (page: Page, label: string, type: string, status: string) => page.getByRole("group", { name: `${label}, ${type}, ${status}` });
const toast = (page: Page, text: string) => page.locator("span").filter({ hasText: text }).last();

async function openEditor(page: Page, id: string) {
  await page.goto(`/workflows/${id}`);
  await expect(page.getByLabel("Workflow name")).toBeVisible();
  await page.waitForLoadState("networkidle");
}

/** Job leads rows as the API has them. */
async function leads(request: APIRequestContext) {
  const table = ((await (await request.get("/api/tables")).json()) as Array<{ id: string; name: string }>).find((t) => t.name === "Job leads")!;
  expect(table, "the Job leads table").toBeTruthy();
  const rows = (await (await request.get(`/api/tables/${table.id}/rows`)).json()).rows as Array<{ id: string; status: string; data: Record<string, string> }>;
  return { tableId: table.id, rows };
}
const byTitle = (rows: Awaited<ReturnType<typeof leads>>["rows"], title: string) => rows.find((r) => r.data.title === title)!;

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test("Run pauses at Pick rows; in the table tick two rows and Continue run (2) drafts them", async ({ page, request }) => {
  const id = await createJobs(request);
  await openEditor(page, id);
  await page.getByRole("button", { name: "Run", exact: true }).click();

  // Run → Waiting for you
  await expect(card(page, "Pick jobs", "Pick rows", "Waiting for you")).toBeVisible({ timeout: 30_000 });
  await expect(card(page, "Save to Job leads", "Save to table", "Done")).toBeVisible();
  const banner = page.getByTestId("waiting-banner");
  await expect(banner).toContainText("Waiting for you: pick rows in “Job leads”, then continue.");
  await expect(card(page, "Draft application", "Agent", "Not run")).toBeVisible();
  const runId = (await (await request.get(`/api/workflows/${id}`)).json()).latestRun.id;
  expect(await runState(request, runId)).toBe("waiting");
  expect((await leads(request)).rows).toHaveLength(9);

  // Open table → pick mode, filtered to the offered status (all 9 rows are new)
  await banner.getByRole("link", { name: "Open table" }).click();
  await expect(page).toHaveURL(/\/tables\/[^/?]+\?pick=/);
  const pickBanner = page.getByTestId("pick-banner");
  await expect(pickBanner).toContainText("Pick up to 10 rows for “Draft application”, then continue.");
  await expect(pickBanner).toContainText("0 picked");
  await expect(page.getByRole("button", { name: /^Continue run \(0\)$/ })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: `Select ${FIRST}` })).toBeVisible();
  await page.waitForLoadState("networkidle");

  // tick 2 → Continue run (2)
  await page.getByRole("checkbox", { name: `Select ${FIRST}` }).check();
  await page.getByRole("checkbox", { name: `Select ${SECOND}` }).check();
  await expect(pickBanner).toContainText("2 picked");
  await page.getByRole("button", { name: "Continue run (2)" }).click();
  await expect(page).toHaveURL(`/workflows/${id}`);
  await expect(toast(page, "Run continued")).toBeVisible();
  await expect(card(page, "Save drafts", "Save to table", "Done")).toBeVisible({ timeout: 30_000 });
  await expect(card(page, "Pick jobs", "Pick rows", "Done")).toBeVisible();
  await expect(card(page, "Draft application", "Agent", "Done")).toBeVisible();
  await expect(page.getByTestId("waiting-banner")).toHaveCount(0);
  expect(await runState(request, runId)).toBe("succeeded");

  // the two picked rows are drafted, the rest untouched; nothing else changed
  const { rows } = await leads(request);
  expect(rows.filter((r) => r.status === "drafted").map((r) => r.data.title).sort()).toEqual([SECOND, FIRST].sort());
  expect(rows.filter((r) => r.status === "new")).toHaveLength(7);
  expect(byTitle(rows, FIRST).data).toMatchObject({ coverLetter: "mock coverLetter", cvNotes: "mock cvNotes", answers: "mock answers" });
  // the apply link is the board's own URL (set by the flow), not something the model wrote
  expect(byTitle(rows, FIRST).data.applyUrl).toBe(byTitle(rows, FIRST).data.url);
  expect(byTitle(rows, FIRST).data.url).toMatch(/^https:\/\/jobs\.ashbyhq\.com\/supabase\//);
});

test("a drafted row's drawer shows the cover letter with a Copy button", async ({ page, request, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const id = await createJobs(request);
  const runId = await startRun(request, id);
  await expect.poll(() => runState(request, runId), { timeout: 30_000 }).toBe("waiting");
  const { rows, tableId } = await leads(request);
  const pick = [byTitle(rows, FIRST).id, byTitle(rows, SECOND).id];
  const cont = await request.post(`/api/workflow-runs/${runId}/resume`, { data: { nodeId: "pick", rowIds: pick } });
  expect(cont.status()).toBe(202);
  await expect.poll(() => runState(request, runId), { timeout: 30_000 }).toBe("succeeded");

  await page.goto(`/tables/${tableId}`);
  await expect(page.getByRole("button", { name: FIRST, exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("combobox", { name: `Status of ${FIRST}` })).toHaveValue("drafted");
  await page.getByRole("button", { name: FIRST, exact: true }).click();
  const drawer = page.getByRole("complementary");
  await expect(drawer.getByRole("heading", { name: "Cover letter" })).toBeVisible();
  await expect(drawer.getByText("mock coverLetter")).toBeVisible();
  await expect(drawer.getByText("Status: drafted")).toBeVisible();
  await drawer.getByRole("button", { name: "Copy Cover letter" }).click();
  await expect(drawer.getByRole("button", { name: "Copy Cover letter" })).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("mock coverLetter");
  // the job link is a link, and nothing in the flow submitted anything
  await expect(drawer.getByRole("link", { name: /^https:\/\/jobs\.ashbyhq\.com\/supabase\// })).toHaveCount(2); // URL and Apply link: the same address
});

test("Cancel run while waiting ends the run as Cancelled and picks nothing", async ({ page, request }) => {
  const id = await createJobs(request);
  await openEditor(page, id);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(card(page, "Pick jobs", "Pick rows", "Waiting for you")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Dismiss" }).click({ timeout: 1000 }).catch(() => {}); // the toast sits over the banner
  const banner = page.getByTestId("waiting-banner");
  await expect(banner).toBeVisible();
  // one Cancel run button while waiting: the banner's
  await expect(page.getByRole("button", { name: "Cancel run" })).toHaveCount(1);
  await banner.getByRole("button", { name: "Cancel run" }).click();

  await expect(toast(page, "Run cancelled")).toBeVisible();
  await expect(banner).toHaveCount(0);
  await expect(card(page, "Pick jobs", "Pick rows", "Cancelled")).toBeVisible();
  const runId = (await (await request.get(`/api/workflows/${id}`)).json()).latestRun.id;
  expect(await runState(request, runId)).toBe("cancelled");
  // a cancelled run cannot be continued
  const { rows } = await leads(request);
  const late = await request.post(`/api/workflow-runs/${runId}/resume`, { data: { nodeId: "pick", rowIds: [rows[0].id] } });
  expect(late.status()).toBe(409);
  expect((await leads(request)).rows.every((r) => r.status === "new")).toBe(true);
});

test("reloading while waiting keeps the banner, and Open table still leads to pick mode", async ({ page, request }) => {
  const id = await createJobs(request);
  await openEditor(page, id);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(card(page, "Pick jobs", "Pick rows", "Waiting for you")).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByTestId("waiting-banner")).toContainText("Waiting for you: pick rows in “Job leads”, then continue.");
  await expect(card(page, "Pick jobs", "Pick rows", "Waiting for you")).toBeVisible();
  await page.getByRole("link", { name: "Open table" }).click();
  await expect(page.getByTestId("pick-banner")).toBeVisible();

  // the list of workflows offers Open for a waiting run
  await page.goto("/workflows");
  await expect(page.getByRole("listitem").filter({ hasText: "Jobs" }).getByRole("link", { name: "Open" })).toBeVisible();
});

test("Continue with none finishes the run and skips the drafts", async ({ page, request }) => {
  const id = await createJobs(request);
  const runId = await startRun(request, id);
  await expect.poll(() => runState(request, runId), { timeout: 30_000 }).toBe("waiting");
  await page.goto(`/tables/${(await leads(request)).tableId}?pick=${runId}`);
  await expect(page.getByTestId("pick-banner")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Continue with none" }).click();
  await expect(page).toHaveURL(`/workflows/${id}`);
  await expect(card(page, "Draft application", "Agent", "Skipped")).toBeVisible({ timeout: 30_000 });
  await expect(card(page, "Pick jobs", "Pick rows", "Done")).toBeVisible();
  expect(await runState(request, runId)).toBe("succeeded");
  expect((await (await request.get(`/api/workflow-runs/${runId}?node=draft`)).json()).skippedReason).toBe("Nothing picked");
  expect((await leads(request)).rows.every((r) => r.status === "new")).toBe(true);
});

test("pick mode stops at the card's limit and shows only the statuses on offer until Show all rows", async ({ page, request }) => {
  const id = await createJobs(request, (g) => (g.nodes.find((n) => n.id === "pick")!.config.maxPick = 2));
  const runId = await startRun(request, id);
  await expect.poll(() => runState(request, runId), { timeout: 30_000 }).toBe("waiting");
  const { tableId, rows } = await leads(request);
  // one lead has moved on already: it is not on offer
  const applied = byTitle(rows, FIRST);
  expect((await request.patch(`/api/tables/${tableId}/rows`, { data: { ids: [applied.id], status: "applied" } })).ok()).toBe(true);

  await page.goto(`/tables/${tableId}?pick=${runId}`);
  await expect(page.getByTestId("pick-banner")).toContainText("Pick up to 2 rows for “Draft application”");
  await expect(page.getByRole("checkbox", { name: `Select ${SECOND}` })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("checkbox", { name: `Select ${FIRST}` })).toHaveCount(0);

  const ticks = page.getByRole("checkbox", { name: /^Select / });
  await ticks.nth(0).check();
  await ticks.nth(1).check();
  await expect(page.getByTestId("pick-banner")).toContainText("2 picked · Up to 2");
  await ticks.nth(2).click({ force: true }); // refused: "Up to 2"
  await expect(page.getByTestId("pick-banner")).toContainText("2 picked");
  await expect(ticks.nth(2)).not.toBeChecked();

  // Show all rows brings back the applied one, which cannot be ticked
  await page.getByRole("button", { name: "Show all rows" }).click();
  await expect(page.getByRole("checkbox", { name: `Select ${FIRST}` })).toBeDisabled();

  // the server refuses it too
  const refused = await request.post(`/api/workflow-runs/${runId}/resume`, { data: { nodeId: "pick", rowIds: [applied.id] } });
  expect(refused.status()).toBe(400);
  expect(await runState(request, runId)).toBe("waiting");
});

test("a run that is no longer waiting says so in the table's pick mode", async ({ page, request }) => {
  const id = await createJobs(request);
  const runId = await startRun(request, id);
  await expect.poll(() => runState(request, runId), { timeout: 30_000 }).toBe("waiting");
  const { tableId } = await leads(request);
  expect((await request.post(`/api/workflow-runs/${runId}/cancel`)).ok()).toBe(true);
  await page.goto(`/tables/${tableId}?pick=${runId}`);
  await expect(page.getByText("That run is not waiting for rows from this table any more.")).toBeVisible();
  await expect(page.getByTestId("pick-banner")).toHaveCount(0);
});
