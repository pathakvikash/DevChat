import { test, expect, type Page } from "./fixtures";
import { createChat, deleteAllChats, openChat } from "./helpers";

const link = (page: Page, title: string) => page.getByRole("link", { name: new RegExp(title) });
const row = (page: Page, title: string) => link(page, title).locator("xpath=..");
const titles = (page: Page) => page.locator("a[href^='/c/'] .truncate.text-sm");

test.beforeEach(async ({ request }) => {
  await deleteAllChats(request);
});

test("pinning moves a chat into the Pinned tab and to the top after a reload", async ({ page, request }) => {
  const first = await createChat(request, { title: "Older chat" });
  await createChat(request, { title: "Newer chat" });
  await createChat(request, { title: "Newest chat" });
  await openChat(page, first);

  await row(page, "Older chat").getByTitle("Pin").click();
  await expect(row(page, "Older chat").getByTitle("Unpin")).toBeVisible();

  await page.getByRole("button", { name: "Pinned", exact: true }).click();
  await expect(titles(page)).toHaveText(["Older chat"]);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(titles(page)).toHaveCount(3);

  await page.reload();
  await expect(titles(page).first()).toHaveText("Older chat");

  await row(page, "Older chat").getByTitle("Unpin").click();
  await expect(row(page, "Older chat").getByTitle("Pin")).toBeVisible();
  await page.getByRole("button", { name: "Pinned", exact: true }).click();
  await expect(page.getByText("No conversations yet")).toBeVisible();
});

test("archiving hides a chat from All, shows it under Archived, and can be undone", async ({ page, request }) => {
  const keep = await createChat(request, { title: "Stays put" });
  await createChat(request, { title: "Goes away" });
  await openChat(page, keep);

  await row(page, "Goes away").getByTitle("More actions").click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(link(page, "Goes away")).toBeHidden();
  await expect(link(page, "Stays put")).toBeVisible();

  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(titles(page)).toHaveText(["Goes away"]);

  await row(page, "Goes away").getByTitle("More actions").click();
  await page.getByRole("button", { name: "Unarchive" }).click();
  await expect(page.getByText("No conversations yet")).toBeVisible();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(titles(page)).toHaveCount(2);

  await page.reload();
  await expect(titles(page)).toHaveCount(2);
});
