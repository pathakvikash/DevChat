import { test, expect } from "@playwright/test";
import { createChat, openChat } from "./helpers";

const heading = (page: import("@playwright/test").Page) => page.getByRole("heading", { name: "Keyboard Shortcuts" });

test("Cmd/Ctrl+/ opens the shortcuts dialog with every group", async ({ page, request }) => {
  await openChat(page, await createChat(request));

  await page.keyboard.press("ControlOrMeta+/");
  await expect(heading(page)).toBeVisible();
  for (const group of ["Navigation", "Chat", "Commands", "Tools"]) {
    await expect(page.getByRole("heading", { name: group, exact: true })).toBeVisible();
  }
  await expect(page.getByText("Open command palette")).toBeVisible();
  await expect(page.getByText("Send message (from any focus)")).toBeVisible();
});

test("the header's More menu opens the dialog and the close button closes it", async ({ page, request }) => {
  await openChat(page, await createChat(request));

  // The sidebar rows have a "More actions" button too, so start from the header's title.
  await page.getByRole("heading", { level: 1 }).locator("xpath=..").getByTitle("More actions").click();
  await page.getByRole("button", { name: "Shortcuts" }).click();
  await expect(heading(page)).toBeVisible();

  await heading(page).locator("xpath=../..").getByRole("button").click();
  await expect(heading(page)).toBeHidden();
});

test("Esc closes the shortcuts dialog", async ({ page, request }) => {
  await openChat(page, await createChat(request));
  await page.keyboard.press("ControlOrMeta+/");
  await expect(heading(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(heading(page)).toBeHidden({ timeout: 2000 });
});
