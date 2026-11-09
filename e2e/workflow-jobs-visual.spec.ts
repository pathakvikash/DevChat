import { test, expect, type APIRequestContext, type Page } from "./fixtures";

// The waiting banner and the table's pick mode, in both themes. The desktop (1280px) and mobile (400px) projects each run this file.
const THEMES = ["dark", "light"] as const;
const FIRST = "Software Engineer - Branching";
const SECOND = "Performance Engineer - Benchmarking";

/** A Jobs run paused at Pick rows, over the recorded boards. Returns the workflow, run and table ids. */
async function seedWaiting(request: APIRequestContext) {
  for (const w of (await (await request.get("/api/workflows")).json()) as Array<{ id: string }>) await request.delete(`/api/workflows/${w.id}`);
  for (const t of (await (await request.get("/api/tables")).json()) as Array<{ id: string }>) await request.delete(`/api/tables/${t.id}`);
  const made = await request.post("/api/workflows", { data: { template: "jobs", model: "mock/workflow" } });
  expect(made.ok(), `creating the workflow: ${made.status()} ${await made.text()}`).toBe(true);
  const id = (await made.json()).id;
  const { graph } = await (await request.get(`/api/workflows/${id}`)).json();
  Object.assign(graph.nodes.find((n: { id: string }) => n.id === "jobs").config, {
    boards: "https://jobs.ashbyhq.com/supabase\nhttps://job-boards.greenhouse.io/vercel\nhttps://jobs.lever.co/spotify",
    titleInclude: "Engineer",
    titleExclude: "",
    locationAllow: "",
  });
  expect((await request.patch(`/api/workflows/${id}`, { data: { graph } })).ok()).toBe(true);
  const started = await request.post(`/api/workflows/${id}/runs`);
  expect(started.ok(), `starting the run: ${started.status()} ${await started.text()}`).toBe(true);
  const { runId } = await started.json();
  await expect.poll(async () => (await (await request.get(`/api/workflow-runs/${runId}`)).json()).state, { timeout: 30_000 }).toBe("waiting");
  const tables: Array<{ id: string; name: string }> = await (await request.get("/api/tables")).json();
  return { id, runId, tableId: tables.find((t) => t.name === "Job leads")!.id };
}

async function settle(page: Page, theme: string) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(2, 2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
}

const relativeTimes = (page: Page) => [page.getByText(/^(just now|\d+[mhd] ago|\d+mo ago)$/)];

for (const theme of THEMES) {
  test(`workflow editor waiting for you, ${theme}`, async ({ page, request }) => {
    await page.addInitScript((t) => (localStorage.setItem("vas:theme", t), localStorage.setItem("vas:workflowView", "list")), theme); // the list view; the canvas has its own baselines
    const { id } = await seedWaiting(request);
    await page.goto(`/workflows/${id}`);
    await expect(page.getByRole("group", { name: "Pick jobs, Pick rows, Waiting for you" })).toBeVisible();
    await expect(page.getByTestId("waiting-banner")).toBeVisible();
    await settle(page, theme);
    await expect(page).toHaveScreenshot(`workflow-waiting-${theme}.png`, { mask: relativeTimes(page) });
  });

  test(`table pick mode with two rows ticked, ${theme}`, async ({ page, request }) => {
    await page.addInitScript((t) => localStorage.setItem("vas:theme", t), theme);
    const { runId, tableId } = await seedWaiting(request);
    await page.goto(`/tables/${tableId}?pick=${runId}`);
    await expect(page.getByTestId("pick-banner")).toBeVisible();
    await page.getByRole("checkbox", { name: `Select ${FIRST}` }).check();
    await page.getByRole("checkbox", { name: `Select ${SECOND}` }).check();
    await expect(page.getByRole("button", { name: "Continue run (2)" })).toBeEnabled();
    await settle(page, theme);
    await expect(page).toHaveScreenshot(`table-pick-mode-${theme}.png`);
  });
}
