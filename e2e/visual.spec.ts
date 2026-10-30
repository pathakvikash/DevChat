import { test, expect, type APIRequestContext, type Page } from "./fixtures";
import { createChat, deleteAllChats, openChat, regenerateButtons, send } from "./helpers";

// Key screens in both themes. The desktop (1280px) and mobile (400px) projects each run this file.
// Review checklist this mirrors: docs/design/ux-guidelines.md section 5 (light + dark, desktop + ~400px,
// no horizontal scroll, empty and loaded states).
const THEMES = ["dark", "light"] as const;

/** A fixed sidebar: one pinned chat, one plain chat, and the chat each test opens. */
async function seed(request: APIRequestContext, model: "mock/echo" | "mock/tool" = "mock/echo") {
  await deleteAllChats(request);
  const design = await createChat(request, { title: "Design review" });
  await request.patch(`/api/conversations/${design}`, { data: { pinned: true } });
  await createChat(request, { title: "Release notes" });
  return createChat(request, { title: "Visual check", model });
}

async function prepare(page: Page, theme: string) {
  await page.addInitScript((t) => localStorage.setItem("vas:theme", t), theme);
}

async function settle(page: Page, theme: string) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(2, 2); // no hover styles in the picture
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
}

// Masked in the pictures: relative times ("just now", "3m ago") change between runs, and the context
// ring's percentage moves whenever the system prompt does (that is not what these screenshots check).
const dynamicBits = (page: Page) => [
  page.getByText(/^(just now|\d+[mhd] ago|\d+mo ago)$/),
  page.locator("button:has(svg[width='36'])"),
];

for (const theme of THEMES) {
  test(`empty state, ${theme}`, async ({ page, request }) => {
    await prepare(page, theme);
    await openChat(page, await seed(request));
    await settle(page, theme);
    await expect(page.getByRole("heading", { name: "Start the conversation" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expect(page).toHaveScreenshot(`empty-state-${theme}.png`, { mask: dynamicBits(page) });
  });

  test(`chat with a reply and a tool card, ${theme}`, async ({ page, request }) => {
    await prepare(page, theme);
    await openChat(page, await seed(request, "mock/tool"));
    await send(page, "what is 6 times 7?");
    await expect(regenerateButtons(page)).toHaveCount(1);
    await page.getByRole("button", { name: /Tool: calculator/ }).click();
    await expect(page.getByText("= 42", { exact: true })).toBeVisible();
    await settle(page, theme);
    await expectNoHorizontalScroll(page);
    await expect(page).toHaveScreenshot(`chat-reply-tool-${theme}.png`, { mask: dynamicBits(page) });
  });

  test(`sidebar, ${theme}`, async ({ page, request }, testInfo) => {
    await prepare(page, theme);
    await openChat(page, await seed(request));
    // Below 768px the sidebar is a drawer behind the menu button.
    const mobile = testInfo.project.name === "mobile";
    if (mobile) await page.getByTitle("Toggle sidebar").click();
    await expect(page.getByRole("link", { name: /Design review/ })).toBeVisible();
    await settle(page, theme);
    await expectNoHorizontalScroll(page);
    await expect(page).toHaveScreenshot(`sidebar-${theme}.png`, mobile ? {} : { clip: { x: 0, y: 0, width: 256, height: 800 } });
  });

  test(`settings, ${theme}`, async ({ page, request }) => {
    await prepare(page, theme);
    await seed(request);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Usage Statistics" })).toBeVisible();
    await settle(page, theme);
    await expectNoHorizontalScroll(page);
    await expect(page).toHaveScreenshot(`settings-${theme}.png`);
  });
}
