import { test, expect, type APIRequestContext, type Page } from "./fixtures";
import { deleteAllChats } from "./helpers";

// The new table screens in both themes. The desktop (1280px) and mobile (400px) projects each run this file.
const THEMES = ["dark", "light"] as const;

/** The News workflow run once, so the News table holds the three fixture articles. Returns the table id. */
async function seed(request: APIRequestContext): Promise<string> {
  for (const w of (await (await request.get("/api/workflows")).json()) as Array<{ id: string }>) await request.delete(`/api/workflows/${w.id}`);
  for (const t of (await (await request.get("/api/tables")).json()) as Array<{ id: string }>) await request.delete(`/api/tables/${t.id}`);
  await deleteAllChats(request);
  const made = await request.post("/api/workflows", { data: { template: "news", model: "mock/workflow" } });
  expect(made.ok(), `creating the workflow: ${made.status()} ${await made.text()}`).toBe(true);
  const id = (await made.json()).id;
  const started = await request.post(`/api/workflows/${id}/runs`);
  expect(started.ok(), `starting the run: ${started.status()} ${await started.text()}`).toBe(true);
  const { runId } = await started.json();
  await expect.poll(async () => (await (await request.get(`/api/workflow-runs/${runId}`)).json()).state, { timeout: 30_000 }).toBe("succeeded");
  const tables: Array<{ id: string; name: string }> = await (await request.get("/api/tables")).json();
  return tables.find((t) => t.name === "News")!.id;
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
  test(`tables list, ${theme}`, async ({ page, request }) => {
    await page.addInitScript((t) => localStorage.setItem("vas:theme", t), theme);
    await seed(request);
    await page.goto("/tables");
    await expect(page.getByRole("link", { name: "News", exact: true })).toBeVisible();
    await settle(page, theme);
    await expect(page).toHaveScreenshot(`tables-list-${theme}.png`, { mask: relativeTimes(page) });
  });

  test(`table view with rows, ${theme}`, async ({ page, request }) => {
    await page.addInitScript((t) => localStorage.setItem("vas:theme", t), theme);
    const id = await seed(request);
    await page.goto(`/tables/${id}`);
    await expect(page.getByRole("button", { name: "New benchmark compares tool-calling models" })).toBeVisible();
    await settle(page, theme);
    await expect(page).toHaveScreenshot(`table-view-${theme}.png`);
  });

  test(`table view with a row open and two ticked, ${theme}`, async ({ page, request }) => {
    await page.addInitScript((t) => localStorage.setItem("vas:theme", t), theme);
    const id = await seed(request);
    await page.goto(`/tables/${id}`);
    await page.getByRole("checkbox", { name: /^Select Local LLM runtime/ }).check();
    await page.getByRole("checkbox", { name: /^Select New benchmark/ }).check();
    await page.getByRole("button", { name: "Open-source coding agent ships plugin API", exact: true }).click();
    await expect(page.getByRole("complementary").getByRole("heading", { name: "Snippet" })).toBeVisible();
    await page.waitForTimeout(600); // the panel's spring animation
    await settle(page, theme);
    await expect(page).toHaveScreenshot(`table-drawer-${theme}.png`);
  });

  test(`empty table, ${theme}`, async ({ page, request }) => {
    await page.addInitScript((t) => localStorage.setItem("vas:theme", t), theme);
    for (const t of (await (await request.get("/api/tables")).json()) as Array<{ id: string }>) await request.delete(`/api/tables/${t.id}`);
    const { id } = await (await request.post("/api/tables", { data: { name: "Job leads" } })).json();
    await page.goto(`/tables/${id}`);
    await expect(page.getByText("No rows yet. Run a workflow that saves here.")).toBeVisible();
    await settle(page, theme);
    await expect(page).toHaveScreenshot(`table-empty-${theme}.png`);
  });
}
