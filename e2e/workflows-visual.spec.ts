import { test, expect, type APIRequestContext, type Page } from "./fixtures";
import { deleteAllChats } from "./helpers";

// The new workflow screens in both themes. The desktop (1280px) and mobile (400px) projects each run this file.
const THEMES = ["dark", "light"] as const;

async function seed(request: APIRequestContext, run: boolean): Promise<string> {
  for (const w of (await (await request.get("/api/workflows")).json()) as Array<{ id: string }>) await request.delete(`/api/workflows/${w.id}`);
  for (const t of (await (await request.get("/api/tables")).json()) as Array<{ id: string }>) await request.delete(`/api/tables/${t.id}`);
  await deleteAllChats(request);
  const id = (await (await request.post("/api/workflows", { data: { template: "news", model: "mock/workflow" } })).json()).id;
  if (run) {
    const { runId } = await (await request.post(`/api/workflows/${id}/runs`)).json();
    await expect.poll(async () => (await (await request.get(`/api/workflow-runs/${runId}`)).json()).state, { timeout: 30_000 }).toBe("succeeded");
  }
  return id;
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
  test(`workflows list, ${theme}`, async ({ page, request }) => {
    await page.addInitScript((t) => localStorage.setItem("vas:theme", t), theme);
    await seed(request, true);
    await page.goto("/workflows");
    await expect(page.getByRole("link", { name: "News digest" })).toBeVisible();
    await settle(page, theme);
    await expect(page).toHaveScreenshot(`workflows-list-${theme}.png`, { mask: relativeTimes(page) });
  });

  test(`workflow editor with the News template, ${theme}`, async ({ page, request }) => {
    await page.addInitScript((t) => localStorage.setItem("vas:theme", t), theme);
    const id = await seed(request, false);
    await page.goto(`/workflows/${id}`);
    await expect(page.getByRole("group", { name: "Write the digest, Agent, Not run" })).toBeVisible();
    await settle(page, theme);
    await expect(page).toHaveScreenshot(`workflow-editor-${theme}.png`);
  });

  test(`workflow editor with a finished run and a card open, ${theme}`, async ({ page, request }) => {
    await page.addInitScript((t) => localStorage.setItem("vas:theme", t), theme);
    const id = await seed(request, true);
    await page.goto(`/workflows/${id}`);
    await expect(page.getByRole("group", { name: "Post to a chat, Send to chat, Done" })).toBeVisible();
    await page.getByRole("button", { name: "Open settings for Write the digest" }).click();
    await expect(page.getByRole("complementary", { name: "Write the digest settings" })).toBeVisible();
    await settle(page, theme);
    await expect(page).toHaveScreenshot(`workflow-run-${theme}.png`, { mask: relativeTimes(page) });
  });
}
