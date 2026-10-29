import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createChat, deleteAllChats, openChat } from "./helpers";

const pane = (page: Page, id: string) => page.locator(`[data-pane-id="${id}"]`);
const composerIn = (page: Page, id: string) => pane(page, id).getByRole("textbox", { name: "Message", exact: true });

// The side chat is created by an async POST after the key press or /side, so poll until it exists.
async function sideIdOf(request: APIRequestContext, mainId: string): Promise<string> {
  const list = async () => (await (await request.get(`/api/conversations/${mainId}/children?kind=side`)).json()) as { id: string }[];
  await expect.poll(async () => (await list()).length, { message: "side chat created" }).toBeGreaterThan(0);
  return (await list())[0].id;
}

test.beforeEach(async ({ request }) => {
  await deleteAllChats(request);
});

test("Cmd+\\ opens a side chat docked next to the main chat, and it reloads from the URL", async ({ page, request }) => {
  const main = await createChat(request, { title: "Main plan" });
  await openChat(page, main);

  await page.keyboard.press("ControlOrMeta+Backslash");

  const side = await sideIdOf(request, main);
  await expect(page).toHaveURL(new RegExp(`/c/${main}\\?split=${side}`));
  await expect(pane(page, side)).toBeVisible();

  await page.reload();
  await expect(pane(page, main)).toBeVisible();
  await expect(pane(page, side)).toBeVisible();
});

test("/side opens a side chat and sends the question there, not in the main chat", async ({ page, request }) => {
  const main = await createChat(request, { title: "Main plan" });
  await openChat(page, main);

  await composerIn(page, main).fill("/side what is 2 plus 2");
  await composerIn(page, main).press("Enter");

  const side = await sideIdOf(request, main);
  await expect(pane(page, side).locator("[data-message-id]")).toHaveCount(2);
  await expect(pane(page, side)).toContainText("You said: what is 2 plus 2");
  await expect(pane(page, main).locator("[data-message-id]")).toHaveCount(0);
});

test("Send to main prefills the main message box and sends nothing", async ({ page, request }) => {
  const main = await createChat(request, { title: "Main plan" });
  await openChat(page, main);
  await page.keyboard.press("ControlOrMeta+Backslash");
  const side = await sideIdOf(request, main);

  await composerIn(page, side).fill("ping 7");
  await composerIn(page, side).press("Enter");
  await expect(pane(page, side).locator("[data-message-id]")).toHaveCount(2);
  await pane(page, side).getByRole("button", { name: "Send to main" }).click();

  await expect(composerIn(page, main)).toHaveValue("Mock reply (deterministic). You said: ping 7");
  await expect(pane(page, main).locator("[data-message-id]")).toHaveCount(0);
});
