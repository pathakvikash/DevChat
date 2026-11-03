import { test, expect, type Page } from "./fixtures";
import { composer, createChat, messages, openChat, regenerateButtons, send, storedMessages } from "./helpers";

// These specs reload first so they work on stored messages; the "sent in this session" cases below skip the reload.
async function sendAndReload(page: Page, text: string) {
  await send(page, text);
  await expect(regenerateButtons(page)).toHaveCount(1);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(messages(page)).toHaveCount(2);
}

test("Regenerate asks how, then replaces the reply with a fresh one", async ({ page, request }) => {
  const id = await createChat(request, { title: "Regenerate test" });
  await openChat(page, id);
  await send(page, "regen me");
  await expect(regenerateButtons(page)).toHaveCount(1);
  const [, first] = await storedMessages(request, id);

  await regenerateButtons(page).click();
  await expect(page.getByRole("heading", { name: "Regenerate Response" })).toBeVisible();
  await expect(page.getByText("Try Again")).toBeVisible();
  await page.getByRole("button", { name: "Regenerate", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Regenerate Response" })).toBeHidden();

  // Still one question and one answer, and the answer is a new message.
  await expect(messages(page)).toHaveCount(2);
  await expect(messages(page).nth(1)).toContainText("You said: regen me");
  await expect(regenerateButtons(page)).toHaveCount(1);
  await expect.poll(async () => (await storedMessages(request, id)).map((m) => m.role)).toEqual(["user", "assistant"]);
  const [, second] = await storedMessages(request, id);
  expect(second.id).not.toBe(first.id);
});

test("Regenerate can be cancelled without changing anything", async ({ page, request }) => {
  const id = await createChat(request);
  await openChat(page, id);
  await send(page, "keep me");
  await expect(regenerateButtons(page)).toHaveCount(1);
  const [, before] = await storedMessages(request, id);

  await regenerateButtons(page).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Regenerate Response" })).toBeHidden();
  const [, after] = await storedMessages(request, id);
  expect(after.id).toBe(before.id);
});

test("Edit rewrites a message and the change survives a reload", async ({ page, request }) => {
  const id = await createChat(request, { title: "Edit test" });
  await openChat(page, id);
  await sendAndReload(page, "original words");

  await page.getByRole("button", { name: "Edit message" }).click();
  const editor = page.getByPlaceholder("Edit your message...");
  await expect(editor).toHaveValue("original words");
  await editor.fill("edited words");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(editor).toBeHidden();
  await expect(page.getByText("edited words", { exact: true })).toBeVisible();
  await expect(page.getByText("original words", { exact: true })).toBeHidden();
  await expect.poll(async () => (await storedMessages(request, id))[0].content).toBe("edited words");

  await page.reload();
  await expect(page.getByText("edited words", { exact: true })).toBeVisible();
});

test("Edit can be cancelled with Escape", async ({ page, request }) => {
  const id = await createChat(request);
  await openChat(page, id);
  await sendAndReload(page, "stay the same");

  await page.getByRole("button", { name: "Edit message" }).click();
  await page.getByPlaceholder("Edit your message...").fill("never saved");
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Edit your message...")).toBeHidden();
  await expect(page.getByText("stay the same", { exact: true })).toBeVisible();
  expect((await storedMessages(request, id))[0].content).toBe("stay the same");
});

test("Edit of a message sent in this session is saved", async ({ page, request }) => {
  const id = await createChat(request);
  await openChat(page, id);
  await send(page, "fresh words");
  await expect(regenerateButtons(page)).toHaveCount(1);

  await page.getByRole("button", { name: "Edit message" }).click();
  await page.getByPlaceholder("Edit your message...").fill("fresh edit");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("fresh edit", { exact: true })).toBeVisible();
  await expect.poll(async () => (await storedMessages(request, id))[0].content, { timeout: 3000 }).toBe("fresh edit");
});

test("Delete removes the message and the ones after it once you confirm", async ({ page, request }) => {
  const id = await createChat(request, { title: "Delete test" });
  await openChat(page, id);
  await sendAndReload(page, "delete me");

  page.once("dialog", (d) => {
    expect(d.message()).toContain("Delete this message and the message after it?");
    return d.accept();
  });
  await page.getByRole("button", { name: "Delete message" }).first().click();

  await expect(messages(page)).toHaveCount(0);
  await expect.poll(async () => await storedMessages(request, id)).toEqual([]);
  await page.reload();
  await expect(messages(page)).toHaveCount(0);
});

test("Delete on a reply keeps the earlier messages and drops everything after it", async ({ page, request }) => {
  const id = await createChat(request);
  await openChat(page, id);
  await send(page, "one");
  await expect(regenerateButtons(page)).toHaveCount(1);
  await send(page, "two");
  await expect(regenerateButtons(page)).toHaveCount(2);

  page.once("dialog", (d) => {
    expect(d.message()).toContain("Delete this message and the 2 messages after it?");
    return d.accept();
  });
  await page.getByRole("button", { name: "Delete message" }).nth(1).click();

  await expect(messages(page)).toHaveCount(1);
  await expect.poll(async () => (await storedMessages(request, id)).map((m) => m.role)).toEqual(["user"]);
  expect((await storedMessages(request, id))[0].content).toBe("one");
});

test("Delete keeps the message when you decline", async ({ page, request }) => {
  const id = await createChat(request);
  await openChat(page, id);
  await sendAndReload(page, "do not delete");

  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Delete message" }).first().click();
  await expect(messages(page)).toHaveCount(2);
  expect(await storedMessages(request, id)).toHaveLength(2);
  await expect(composer(page)).toBeEnabled();
});

test("Delete of a message sent in this session is saved", async ({ page, request }) => {
  const id = await createChat(request);
  await openChat(page, id);
  await send(page, "fresh delete");
  await expect(regenerateButtons(page)).toHaveCount(1);

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete message" }).first().click();
  await expect(page.getByText("fresh delete", { exact: true })).toBeHidden();
  await expect.poll(async () => (await storedMessages(request, id)).map((m) => m.role), { timeout: 3000 }).toEqual([]);
});
