import { test, expect } from "./fixtures";
import { createChat, deleteAllChats, openChat } from "./helpers";

const GOOD = "flowchart TD\n  A[Start] --> B[Done]";
const BAD = "flowchart TD\n  A[Start] -->";
const TS = "const answer: number = 42;";
const REPLY = ["Here you go.", "```mermaid\n" + GOOD + "\n```", "```mermaid\n" + BAD + "\n```", "```ts\n" + TS + "\n```"].join("\n\n");

test.beforeEach(async ({ request, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await deleteAllChats(request);
});

async function seeded(page: import("./fixtures").Page, request: import("./fixtures").APIRequestContext, theme = "dark") {
  await page.addInitScript((t) => localStorage.setItem("vas:theme", t), theme);
  const id = await createChat(request, { title: "Diagrams" });
  const res = await request.post(`/api/conversations/${id}/messages`, { data: { role: "assistant", content: REPLY } });
  expect(res.ok()).toBeTruthy();
  await openChat(page, id);
}

test("a mermaid fence draws an SVG; the toggle and Copy work", async ({ page, request }) => {
  await seeded(page, request);
  const diagram = page.getByRole("img", { name: "Flowchart diagram" });
  await expect(diagram.locator("svg")).toBeVisible();

  const toggle = page.getByRole("button", { name: "Show code" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  const hide = page.getByRole("button", { name: "Show diagram" });
  await expect(hide).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("pre", { hasText: "A[Start] --> B[Done]" }).last()).toBeVisible();
  await expect(diagram).toHaveCount(0);
  await hide.click();
  await expect(diagram.locator("svg")).toBeVisible();

  await page.getByRole("button", { name: "Copy" }).first().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(GOOD);
});

test("a broken diagram shows its code and one plain error line; the ts block is untouched", async ({ page, request }) => {
  await seeded(page, request);
  await expect(page.getByText(/^Couldn.t draw this diagram\. \S/)).toHaveCount(1);
  await expect(page.locator("pre", { hasText: /A\[Start\] -->$/ }).last()).toBeVisible();
  await expect(page.getByRole("img", { name: "Flowchart diagram" })).toHaveCount(1);
  await expect(page.getByText("const answer: number = 42;")).toBeVisible();
  await expect(page.getByText("ts", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show code" })).toHaveCount(1); // only the good diagram has the toolbar
});

test("dark, 1280px", async ({ page, request }) => {
  await seeded(page, request);
  await expect(page.getByRole("img", { name: "Flowchart diagram" }).locator("svg")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(2, 2);
  await expect(page).toHaveScreenshot("chat-mermaid-dark.png", {
    mask: [page.getByText(/^(just now|\d+[mhd] ago|\d+mo ago)$/), page.locator("button:has(svg[width='36'])")],
  });
});
