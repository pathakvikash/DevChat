import path from "node:path";
import { test, expect } from "./fixtures";
import { composer, createChat, messages, openChat, regenerateButtons, send, storedMessages } from "./helpers";

// mock/notools has no tool support, so /recall must work without the model's searchChats tool.
test("/recall finds an older chat and shows it as a result card, not as text in the message", async ({ page, request }) => {
  const phrase = `zebrafruit-${Date.now()}`;
  const older = await createChat(request, { title: "Recall source chat", model: "mock/notools" });
  await openChat(page, older);
  await send(page, `our ${phrase} plan`);
  await expect(regenerateButtons(page)).toHaveCount(1);
  await expect.poll(async () => (await storedMessages(request, older)).length).toBe(2);

  await openChat(page, await createChat(request, { title: "Recall asker", model: "mock/notools" }));
  await send(page, `/recall ${phrase}`);

  const asked = messages(page).first();
  await expect(asked.getByText(`/recall ${phrase}`, { exact: true })).toBeVisible();
  const card = asked.getByRole("group", { name: "Past chat search" });
  await expect(card).toContainText(`Searched past chats for "${phrase}"`);
  const row = card.getByRole("link", { name: /Recall source chat/ });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("href", `/c/${older}`);
  await expect(row).toContainText(phrase);
});

test('the palette\'s "Search past chats" fills /recall for you to finish', async ({ page, request }) => {
  await openChat(page, await createChat(request, { model: "mock/notools" }));

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("option", { name: "Search past chats" }).click();

  await expect(palette).toBeHidden();
  await expect(composer(page)).toHaveValue("/recall ");
});

test("/recall says when a chat that read files was left out", async ({ page, request }) => {
  const phrase = `quincefile-${Date.now()}`;
  const reader = await createChat(request, { title: "Recall folder reader", model: "mock/files" });
  const set = await request.patch(`/api/conversations/${reader}`, { data: { workingFolder: path.join(__dirname, "fixtures/project") } });
  expect(set.ok()).toBeTruthy();
  await openChat(page, reader);
  await send(page, `what does the notes file export? ${phrase}`);
  await expect(regenerateButtons(page)).toHaveCount(1);
  await expect(messages(page).nth(1).getByRole("button", { name: /Tool: readFile/ })).toBeVisible();

  await openChat(page, await createChat(request, { title: "Recall asker", model: "mock/notools" }));
  await send(page, `/recall ${phrase}`);

  const card = messages(page).first().getByRole("group", { name: "Past chat search" });
  await expect(card).toContainText("No past chats matched");
  await expect(card).toContainText("1 matching chat is not shown because it read files from a folder.");
  await expect(card.getByRole("link")).toHaveCount(0);
});
