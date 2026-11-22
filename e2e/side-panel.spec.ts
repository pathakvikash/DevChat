import { test, expect, type Page } from "./fixtures";
import { createChat, deleteAllChats, openChat } from "./helpers";

const launcherButton = (page: Page) => page.getByRole("button", { name: "Panel", exact: true });
const launcher = (page: Page) => page.getByRole("menu", { name: "Panel" });
// A docked panel is an aside (complementary); in a narrow pane it is a modal sheet with the dialog role.
const panel = (page: Page) => page.locator('aside[aria-label="Chat panel"]');
const handle = (page: Page) => panel(page).getByRole("separator", { name: "Resize panel" });

test.beforeEach(({ request }) => deleteAllChats(request));

test("the launcher lists only the kept entries", async ({ page, request }) => {
  await openChat(page, await createChat(request));
  await launcherButton(page).click();
  // Files needs host tools and a folder; Browser, Terminal, Simulator and PRs are out of scope.
  const names = (await launcher(page).getByRole("menuitem").allInnerTexts()).map((t) => t.split("\n")[0].trim());
  expect(names).toEqual(["Side chat", "Outputs", "Background tasks", "Context", "Connectors", "Notes", "Todos"]);
  await expect(launcher(page).getByRole("menuitem").first()).toBeFocused();

  await page.keyboard.press("End");
  await expect(launcher(page).getByRole("menuitem", { name: /^Todos/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(launcher(page)).toBeHidden();
  await expect(launcherButton(page)).toBeFocused();
});

test("a launcher entry opens its view, and a reload restores it", async ({ page, request }) => {
  const id = await createChat(request);
  await openChat(page, id);
  await launcherButton(page).click();
  await launcher(page).getByRole("menuitem", { name: /^Connectors/ }).click();

  await expect(page).toHaveURL(/panel=connectors/);
  await expect(panel(page).getByRole("tab", { name: "Connectors" })).toHaveAttribute("aria-selected", "true");
  await expect(panel(page).getByRole("link", { name: "Manage in Settings" })).toHaveAttribute("href", "/settings/mcp");

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(panel(page).getByRole("tab", { name: "Connectors" })).toHaveAttribute("aria-selected", "true");

  // Tabs switch the view and the URL; the panel's own close button removes the param.
  await panel(page).getByRole("tab", { name: "Notes" }).click();
  await expect(page).toHaveURL(/panel=notes/);
  await panel(page).getByRole("button", { name: "Close panel" }).click();
  await expect(panel(page)).toBeHidden();
  await expect(page).not.toHaveURL(/panel=/);
});

test("Alt+P toggles the panel and reopens the last view", async ({ page, request }) => {
  await openChat(page, await createChat(request));
  await page.keyboard.press("Alt+KeyT"); // not bound: nothing happens
  await expect(panel(page)).toBeHidden();

  await page.keyboard.press("Alt+Digit4"); // Background tasks
  await expect(page).toHaveURL(/panel=tasks/);
  await expect(panel(page)).toBeVisible();

  await page.keyboard.press("Alt+KeyP");
  await expect(panel(page)).toBeHidden();
  await page.keyboard.press("Alt+KeyP");
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("tab", { name: "Background tasks" })).toHaveAttribute("aria-selected", "true");
});

test("Escape closes the panel when focus is inside it", async ({ page, request }) => {
  await openChat(page, await createChat(request));
  await page.keyboard.press("Alt+Digit5");
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("tab", { selected: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
});

test("the panel and a side chat share the row", async ({ page, request }) => {
  const main = await createChat(request, { title: "Main plan" });
  await openChat(page, main);
  await page.keyboard.press("Alt+Digit4");
  await expect(panel(page)).toBeVisible();

  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect(page).toHaveURL(new RegExp(`/c/${main}\\?.*split=`));
  await expect(page).toHaveURL(/panel=tasks/);
  const panes = page.locator("[data-pane-id]");
  await expect(panes).toHaveCount(2);
  // The panel lives in the main chat's pane, not the side chat's. Beside a side chat the main pane is under 768px, so it is a sheet over that pane only.
  await expect(panes.first().locator('aside[aria-label="Chat panel"]')).toBeVisible();
  await expect(panes.nth(1).locator('aside[aria-label="Chat panel"]')).toHaveCount(0);
  await expect(panes.nth(1).getByRole("textbox", { name: "Message", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator("[data-pane-id]")).toHaveCount(2);
  await expect(panel(page)).toBeVisible();
});

test("resizing by keyboard persists, and double-click resets", async ({ page, request }) => {
  const id = await createChat(request);
  await openChat(page, id);
  await page.keyboard.press("Alt+Digit4");
  await expect(panel(page)).toBeVisible();
  const width = async () => Math.round((await panel(page).boundingBox())!.width);
  expect(await width()).toBe(420);

  await handle(page).focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await width()).toBe(420 + 16 + 64);
  expect(await page.evaluate(() => localStorage.getItem("vas:panel:width"))).toBe("500");

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect.poll(width).toBe(500);

  await handle(page).dblclick();
  await expect.poll(width).toBe(420);
});

test.describe("at mobile width", () => {
  test.use({ viewport: { width: 400, height: 800 } });

  test("the panel is a full sheet and Escape closes it", async ({ page, request }) => {
    await openChat(page, await createChat(request));
    await launcherButton(page).click();
    await launcher(page).getByRole("menuitem", { name: /^Context/ }).click();

    const sheet = panel(page);
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("aria-modal", "true");
    await expect(sheet).toHaveAttribute("data-panel-mode", "sheet");
    const pane = await page.locator("[data-pane-id]").boundingBox();
    const box = await sheet.boundingBox();
    expect(Math.round(box!.width)).toBe(Math.round(pane!.width));
    expect(Math.round(box!.height)).toBe(Math.round(pane!.height));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });
});
