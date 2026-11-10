import { test, expect } from "./fixtures";
import { createChat, openChat, send } from "./helpers";

test("/help opens the keyboard shortcuts dialog", async ({ page, request }) => {
  await openChat(page, await createChat(request));

  await send(page, "/help "); // trailing space: without it Enter only completes the command name
  await expect(page.getByRole("heading", { name: "Keyboard Shortcuts" })).toBeVisible();
  await expect(page.getByText("Open command palette")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Slash commands", exact: true })).toBeVisible();
  await expect(page.getByText("/compress [focus]")).toBeVisible();
});

test("the palette still lists the Shortcuts group", async ({ page, request }) => {
  await openChat(page, await createChat(request));

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette.getByText("Shortcuts", { exact: true })).toBeVisible();
  await expect(palette.getByText("Open this palette")).toBeVisible();
});
