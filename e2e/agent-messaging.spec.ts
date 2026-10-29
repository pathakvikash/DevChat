import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createChat, deleteAllChats, messages, openChat, regenerateButtons, send } from "./helpers";

const pane = (page: Page, id: string) => page.locator(`[data-pane-id="${id}"]`);
const composerIn = (page: Page, id: string) => pane(page, id).getByRole("textbox", { name: "Message", exact: true });

/** A side chat of `mainId` on `model`, created before the pane opens so the side uses that model. */
async function createSide(request: APIRequestContext, mainId: string, model: string): Promise<string> {
  const res = await request.post(`/api/conversations/${mainId}/children`, { data: { model } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id;
}

test.beforeEach(async ({ request }) => {
  await deleteAllChats(request);
});

test("a main chat's sendToChat reaches its side chat with a badge, and it survives a reload", async ({ page, request }) => {
  const main = await createChat(request, { title: "Main plan", model: "mock/talker" });
  const side = await createSide(request, main, "mock/echo");
  await openChat(page, main);
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect(page).toHaveURL(new RegExp(`split=${side}`));

  await send(page, "ask the side chat");

  await expect(pane(page, side).getByText('From "Main plan"')).toBeVisible({ timeout: 30000 });
  await expect(pane(page, side)).toContainText("ping from main");
  await expect(pane(page, main)).toContainText("sent");

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(pane(page, side).getByText('From "Main plan"')).toBeVisible();
});

test("Stop ends an agent exchange: the talking row goes and the side chat's reply stops", async ({ page, request }) => {
  const main = await createChat(request, { title: "Main plan", model: "mock/talker" });
  const side = await createSide(request, main, "mock/slow");
  await openChat(page, main);
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect(page).toHaveURL(new RegExp(`split=${side}`));

  await send(page, "ask the side chat");

  // mock/slow streams for about 7 s, so the exchange is still on when Stop is pressed.
  await expect(pane(page, main).getByText(/Talking with/)).toBeVisible({ timeout: 30000 });
  await pane(page, main).getByRole("button", { name: "Stop all agent messages" }).click();

  await expect(pane(page, main).getByText(/Talking with/)).toHaveCount(0);
  await expect(pane(page, side).getByText(/Talking with/)).toHaveCount(0);
  await expect(composerIn(page, side)).toBeEnabled();
});

test("a tool-less model's reply goes to the side chat from the Send to menu", async ({ page, request }) => {
  const main = await createChat(request, { title: "Main plan", model: "mock/notools" });
  const side = await createSide(request, main, "mock/echo");
  await openChat(page, main);
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect(page).toHaveURL(new RegExp(`split=${side}`));

  await composerIn(page, main).fill("hello from main");
  await composerIn(page, main).press("Enter");
  await expect(pane(page, main).getByRole("button", { name: "Regenerate message" })).toHaveCount(1, { timeout: 30000 });

  await pane(page, main).getByRole("button", { name: "Send to another chat" }).click();
  await pane(page, main).getByRole("button", { name: /^Send to "/ }).click();

  await expect(pane(page, side).getByText('From "Main plan"')).toBeVisible({ timeout: 30000 });
  await expect(pane(page, side).locator("[data-message-id]")).toHaveCount(2, { timeout: 30000 });
});

test("Open on a sub-agent card shows its transcript as a read-only pane", async ({ page, request }) => {
  const id = await createChat(request, { title: "Sub-agent test", model: "mock/subagent" });
  await openChat(page, id);
  await send(page, "summarise my notes");
  await expect(regenerateButtons(page)).toHaveCount(1);
  await expect(messages(page).nth(1).getByRole("group", { name: "Sub-agent: Note reader" })).toBeVisible();

  const [child] = (await (await request.get(`/api/conversations/${id}/children?kind=subagent`)).json()) as { id: string }[];
  await messages(page).nth(1).getByRole("group", { name: "Sub-agent: Note reader" }).getByRole("button", { name: "Open" }).click();

  await expect(page).toHaveURL(new RegExp(`split=${child.id}`));
  const transcript = pane(page, child.id);
  await expect(transcript).toContainText("Sub-agent transcript · read only");
  await expect(transcript.getByRole("textbox", { name: "Message", exact: true })).toHaveCount(0);
  await expect(transcript).toContainText("Mock helper report");
});
