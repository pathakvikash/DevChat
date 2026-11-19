import path from "node:path";
import { realpathSync } from "node:fs";
import { test, expect, type Page } from "./fixtures";
import { composer, createChat, openChat, send } from "./helpers";

// A folder inside the fixtures project that no spec adds permanently.
const ADDED = realpathSync(path.join(__dirname, "fixtures/project/src"));

test.afterEach(async ({ request }) => {
  await request.delete("/api/folders", { data: { path: ADDED } }); // 404 when a test already removed it
});

const picker = (page: Page) => page.getByRole("combobox", { name: "Working folder" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Choose a folder" });
const subFolders = (page: Page) => dialog(page).getByRole("list", { name: "Sub-folders" });
const useFolder = (page: Page) => dialog(page).getByRole("button", { name: "Use this folder" });

async function openDialog(page: Page) {
  await picker(page).selectOption({ label: "Choose folder…" });
  await expect(dialog(page)).toBeVisible();
  await expect(subFolders(page).getByRole("button", { name: "project", exact: true })).toBeVisible();
}

test("Choose folder… adds and selects a folder; @ lists its files", async ({ page, request }) => {
  await openChat(page, await createChat(request, { title: "Pick a folder" }));
  await openDialog(page);
  await expect(subFolders(page).getByRole("button", { name: "workflows", exact: true })).toBeVisible();

  await subFolders(page).getByRole("button", { name: "project", exact: true }).click();
  await subFolders(page).getByRole("button", { name: "src", exact: true }).click();
  await expect(dialog(page).getByRole("navigation", { name: "Breadcrumb" }).locator("[aria-current=page]")).toHaveText("src");
  await useFolder(page).click();
  await expect(dialog(page)).toBeHidden();

  await expect(picker(page)).toHaveValue(ADDED);
  await expect(picker(page)).toBeFocused(); // the dialog hands focus back to what opened it
  const list = await (await request.get("/api/folders")).json();
  expect(list.folders).toContainEqual({ path: ADDED, source: "added" });

  await composer(page).fill("look at @");
  await expect(page.getByText("Files in src")).toBeVisible();
  await expect(page.getByRole("button", { name: /notes\.ts/ })).toBeVisible();
});

test("pasted paths are browsed; refusals show in the dialog", async ({ page, request }) => {
  await openChat(page, await createChat(request, { title: "Refusals" }));
  await openDialog(page);
  const status = dialog(page).getByRole("status");

  await dialog(page).getByLabel("Folder path").fill("/");
  await useFolder(page).click();
  await expect(status).toContainText("whole disk");
  await expect(dialog(page)).toBeVisible();

  await dialog(page).getByLabel("Folder path").fill("/no/such/devchat-folder");
  await useFolder(page).click();
  await expect(status).toContainText("No folder at");

  await dialog(page).getByLabel("Folder path").fill("/");
  await page.keyboard.press("Enter"); // Enter browses; "/" has no parent
  await expect(dialog(page).getByRole("button", { name: "Parent folder" })).toBeDisabled();

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(picker(page)).toHaveValue("");
});

test("removing a folder in Settings makes the chat fail closed", async ({ page, request }) => {
  const id = await createChat(request, { title: "Removed folder" });
  expect((await request.post("/api/folders", { data: { path: ADDED } })).ok()).toBeTruthy();
  expect((await request.patch(`/api/conversations/${id}`, { data: { workingFolder: ADDED } })).ok()).toBeTruthy();

  await page.goto("/settings");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^Remove .*project\/src$/ }).click();
  await expect(page.getByText("Folder removed. Chats using it will ask you to pick another.")).toBeVisible();

  await openChat(page, id);
  await send(page, "hello after removal");
  await expect(page.getByText(/isn't one of your folders any more/).first()).toBeVisible();
  await expect(picker(page).locator("option", { hasText: "(removed)" })).toHaveCount(1);
  expect((await request.get(`/api/conversations/${id}/files`)).status()).toBe(400);
});

test.describe("at 400px", () => {
  test.use({ viewport: { width: 400, height: 800 } });

  test("the model settings folder picker opens the dialog without sideways scroll", async ({ page, request }) => {
    await openChat(page, await createChat(request, { title: "Narrow" }));
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("option", { name: "Model Settings", exact: true }).click();

    await picker(page).selectOption({ label: "Choose folder…" });
    await expect(dialog(page)).toBeVisible();
    await expect(subFolders(page).getByRole("button", { name: "project", exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    // Escape belongs to the folder dialog only: the panel under it stays open.
    await expect(page.getByRole("heading", { name: "Model Settings" })).toBeVisible();
  });
});
