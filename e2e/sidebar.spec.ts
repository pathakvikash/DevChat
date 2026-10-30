import { test, expect, type Page } from "./fixtures";
import { createChat, deleteAllChats, openChat } from "./helpers";

const link = (page: Page, title: string) => page.getByRole("link", { name: new RegExp(title) });
const rows = (page: Page) => page.locator("a[href^='/c/']");

test.beforeEach(async ({ request }) => {
  await deleteAllChats(request);
});

test("the sidebar lists chats and opens one on click", async ({ page, request }) => {
  const alpha = await createChat(request, { title: "Alpha plan" });
  await createChat(request, { title: "Beta notes", model: "mock/slow" });
  await createChat(request, { title: "Gamma ideas" });
  await openChat(page, alpha);

  for (const title of ["Alpha plan", "Beta notes", "Gamma ideas"]) await expect(link(page, title)).toBeVisible();
  await expect(page.getByText("Total: 3 conversations")).toBeVisible();
  // Each row names its model.
  await expect(link(page, "Beta notes")).toContainText("slow");

  await link(page, "Gamma ideas").click();
  await expect(page).toHaveURL(/\/c\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: "Gamma ideas" })).toBeVisible();
});

test("search narrows the list and clears back", async ({ page, request }) => {
  const alpha = await createChat(request, { title: "Alpha plan" });
  await createChat(request, { title: "Beta notes" });
  await createChat(request, { title: "Gamma ideas" });
  await openChat(page, alpha);
  const search = page.getByPlaceholder("Search conversations...");

  await search.fill("beta");
  await expect(rows(page)).toHaveCount(1);
  await expect(link(page, "Beta notes")).toBeVisible();

  await search.fill("zzz-nothing");
  await expect(page.getByText("No conversations yet")).toBeVisible();

  await search.fill("");
  await expect(rows(page)).toHaveCount(3);
});

test("a chat deleted from the sidebar menu is gone for good", async ({ page, request }) => {
  const keep = await createChat(request, { title: "Keep me" });
  await createChat(request, { title: "Remove me" });
  await openChat(page, keep);

  page.once("dialog", (d) => d.accept());
  await link(page, "Remove me").locator("xpath=..").getByTitle("More actions").click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(link(page, "Remove me")).toBeHidden();
  await page.reload();
  await expect(rows(page)).toHaveCount(1);
});

test("a chat can be renamed from the sidebar menu", async ({ page, request }) => {
  const id = await createChat(request, { title: "Old name" });
  await openChat(page, id);

  await link(page, "Old name").locator("xpath=..").getByTitle("More actions").click();
  await page.getByRole("button", { name: "Rename" }).click();
  const input = page.locator("input[type='text']:focus");
  await input.fill("New name");
  await page.keyboard.press("Enter");
  await expect(link(page, "New name")).toBeVisible();
  await expect
    .poll(async () => (await (await request.get(`/api/conversations/${id}`)).json()).title)
    .toBe("New name");
});
