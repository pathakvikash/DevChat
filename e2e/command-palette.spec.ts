import { test, expect } from "@playwright/test";
import { createChat, openChat } from "./helpers";

const palette = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: "Command palette" });
const paletteInput = (page: import("@playwright/test").Page) => page.getByPlaceholder("Type a command or search…");

test("Cmd/Ctrl+K opens the palette and Esc closes it", async ({ page, request }) => {
  await openChat(page, await createChat(request));

  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toBeVisible();
  await expect(paletteInput(page)).toBeFocused();
  for (const item of ["New Chat", "Settings Page", "Open Scratchpad", "Open Artifacts", "Advanced Settings", "Model Settings", "Context Usage"]) {
    await expect(palette(page).getByRole("option", { name: item })).toBeVisible();
  }

  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();

  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toBeHidden();
});

test("typing filters the palette and Enter runs the action", async ({ page, request }) => {
  await openChat(page, await createChat(request));
  await page.keyboard.press("ControlOrMeta+k");

  await paletteInput(page).fill("zzzz-no-such-thing");
  await expect(palette(page).getByText("No results found.")).toBeVisible();

  await paletteInput(page).fill("settings page");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings & Analytics" })).toBeVisible();
});

test("a panel action from the palette opens that panel", async ({ page, request }) => {
  await openChat(page, await createChat(request));
  await page.keyboard.press("ControlOrMeta+k");
  await paletteInput(page).fill("advanced");
  await page.keyboard.press("Enter");
  await expect(palette(page)).toBeHidden();
  await expect(page.getByText("Per-conversation tools & skills")).toBeVisible();
});

test("New Chat in the palette creates and opens a chat", async ({ page, request }) => {
  const id = await createChat(request);
  await openChat(page, id);
  await page.keyboard.press("ControlOrMeta+k");
  await palette(page).getByRole("option", { name: "New Chat" }).click();
  await page.waitForURL((url) => /^\/c\/[a-z0-9]+$/.test(url.pathname) && !url.pathname.endsWith(id));
  await expect(page.getByText("0 messages")).toBeVisible();
});

// Known bug: createNewChat() in CommandPalette.tsx never calls setOpen(false), so the palette
// stays open (and hides the page from assistive tech) after New Chat.
// When this is fixed the test starts passing, test.fail() complains, and the line can go.
test.fail("the palette closes after New Chat (known bug)", async ({ page, request }) => {
  await openChat(page, await createChat(request));
  await page.keyboard.press("ControlOrMeta+k");
  await palette(page).getByRole("option", { name: "New Chat" }).click();
  await expect(palette(page)).toBeHidden({ timeout: 3000 });
});
