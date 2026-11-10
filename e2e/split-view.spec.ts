import { test, expect, type Page } from "./fixtures";
import { createChat, deleteAllChats, openChat } from "./helpers";

const link = (page: Page, title: string) => page.getByRole("link", { name: new RegExp(title) });
const pane = (page: Page, title: string) => page.getByRole("region", { name: title });
const row = (page: Page, title: string) => link(page, title).locator("xpath=..");
const anyMarker = (page: Page) => page.getByRole("img", { name: /^Open in split view, pane / });

async function openInSplitFromMenu(page: Page, title: string) {
  await link(page, title).locator("xpath=..").getByTitle("More actions").click();
  await page.getByRole("button", { name: "Open in split view" }).click();
}

test.beforeEach(async ({ request }) => {
  await deleteAllChats(request);
});

test("a chat opens in split view from the sidebar menu", async ({ page, request }) => {
  const alpha = await createChat(request, { title: "Alpha plan" });
  const beta = await createChat(request, { title: "Beta notes" });
  await openChat(page, alpha);

  await openInSplitFromMenu(page, "Beta notes");

  await expect(page).toHaveURL(new RegExp(`/c/${alpha}\\?split=${beta}&focus=${beta}$`));
  await expect(pane(page, "Alpha plan")).toBeVisible();
  await expect(pane(page, "Beta notes")).toHaveAttribute("data-focused", "true");
});

test("every chat open in a pane is marked in the sidebar, the focused one too", async ({ page, request }) => {
  const alpha = await createChat(request, { title: "Alpha plan" });
  await createChat(request, { title: "Beta notes" });
  await createChat(request, { title: "Gamma ideas" });
  await openChat(page, alpha);
  // One open chat keeps the plain look.
  await expect(anyMarker(page)).toHaveCount(0);

  await openInSplitFromMenu(page, "Beta notes");
  await expect(pane(page, "Beta notes")).toHaveAttribute("data-focused", "true");

  await expect(row(page, "Alpha plan").getByRole("img", { name: "Open in split view, pane 1 of 2" })).toBeVisible();
  await expect(row(page, "Beta notes").getByRole("img", { name: "Open in split view, pane 2 of 2" })).toBeVisible();
  await expect(row(page, "Gamma ideas").getByRole("img")).toHaveCount(0);

  await page.getByRole("button", { name: "Close Beta notes" }).click();
  await expect(pane(page, "Beta notes")).toHaveCount(0);
  await expect(anyMarker(page)).toHaveCount(0);
});

test("the split comes back from the URL after a reload", async ({ page, request }) => {
  const alpha = await createChat(request, { title: "Alpha plan" });
  const beta = await createChat(request, { title: "Beta notes" });
  await openChat(page, alpha);
  await openInSplitFromMenu(page, "Beta notes");
  await expect(pane(page, "Beta notes")).toBeVisible();

  await page.reload();
  await page.waitForLoadState("networkidle");

  await expect(page).toHaveURL(new RegExp(`/c/${alpha}\\?split=${beta}&focus=${beta}$`));
  await expect(pane(page, "Alpha plan")).toBeVisible();
  await expect(pane(page, "Beta notes")).toHaveAttribute("data-focused", "true");
});

test("closing a pane leaves the other one open", async ({ page, request }) => {
  const alpha = await createChat(request, { title: "Alpha plan" });
  await createChat(request, { title: "Beta notes" });
  await openChat(page, alpha);
  await openInSplitFromMenu(page, "Beta notes");
  await expect(pane(page, "Beta notes")).toBeVisible();

  await page.getByRole("button", { name: "Close Beta notes" }).click();

  await expect(page).toHaveURL(new RegExp(`/c/${alpha}$`));
  await expect(pane(page, "Beta notes")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
});

test("the opening limit disables the menu item at this width", async ({ page, request }) => {
  // The desktop project is 1280px wide, so two panes is the limit.
  const alpha = await createChat(request, { title: "Alpha plan" });
  await createChat(request, { title: "Beta notes" });
  await createChat(request, { title: "Gamma ideas" });
  await openChat(page, alpha);
  await openInSplitFromMenu(page, "Beta notes");
  await expect(pane(page, "Beta notes")).toBeVisible();

  await link(page, "Gamma ideas").locator("xpath=..").getByTitle("More actions").click();
  const item = page.getByRole("button", { name: "Open in split view" });
  await expect(item).toHaveAttribute("aria-disabled", "true");
  // aria-disabled, not disabled: the item stays tappable and explains why. Playwright treats it as not enabled, so force the click.
  await item.click({ force: true });

  await expect(page.getByText("Close a pane first. Up to 2 fit at this width.")).toBeVisible();
  await expect(pane(page, "Gamma ideas")).toHaveCount(0);
});

test("two panes stream at once and both finish", async ({ page, request }) => {
  const alpha = await createChat(request, { title: "Alpha plan", model: "mock/slow" });
  await createChat(request, { title: "Beta notes", model: "mock/slow" });
  await openChat(page, alpha);
  await openInSplitFromMenu(page, "Beta notes");

  await pane(page, "Alpha plan").getByRole("textbox", { name: "Message", exact: true }).fill("alpha question");
  await pane(page, "Alpha plan").getByRole("textbox", { name: "Message", exact: true }).press("Enter");
  await pane(page, "Beta notes").getByRole("textbox", { name: "Message", exact: true }).fill("beta question");
  await pane(page, "Beta notes").getByRole("textbox", { name: "Message", exact: true }).press("Enter");

  await expect(pane(page, "Alpha plan").getByText("alpha question").first()).toBeVisible();
  await expect(pane(page, "Beta notes").getByText("beta question").first()).toBeVisible();
  await expect(pane(page, "Alpha plan").locator("[data-message-id]")).toHaveCount(2, { timeout: 30000 });
  await expect(pane(page, "Beta notes").locator("[data-message-id]")).toHaveCount(2, { timeout: 30000 });
});
