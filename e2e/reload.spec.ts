import { test, expect } from "./fixtures";
import { createChat, messages, openChat, regenerateButtons, send } from "./helpers";

test("a reload keeps every message, and the chat still works afterwards", async ({ page, request }) => {
  const id = await createChat(request, { title: "Reload test" });
  await openChat(page, id);
  await send(page, "remember one");
  await expect(regenerateButtons(page)).toHaveCount(1);
  await send(page, "remember two");
  await expect(regenerateButtons(page)).toHaveCount(2);
  await expect(messages(page)).toHaveCount(4);

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(messages(page)).toHaveCount(4);
  await expect(messages(page).nth(0)).toContainText("remember one");
  await expect(messages(page).nth(1)).toContainText("You said: remember one");
  await expect(messages(page).nth(2)).toContainText("remember two");
  await expect(messages(page).nth(3)).toContainText("You said: remember two");
  await expect(page.getByText("4 messages")).toBeVisible();

  await send(page, "remember three");
  await expect(messages(page)).toHaveCount(6);
  await expect(messages(page).nth(5)).toContainText("You said: remember three");
});

test("opening a chat id that does not exist says so", async ({ page }) => {
  await page.goto("/c/does-not-exist");
  await expect(page.getByText("This chat no longer exists")).toBeVisible();
});
