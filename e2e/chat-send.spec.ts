import { test, expect } from "@playwright/test";
import { composer, createChat, messages, openChat, regenerateButtons, send, storedMessages } from "./helpers";

test("sending a message streams the mock/echo reply and saves both messages", async ({ page, request }) => {
  const id = await createChat(request, { title: "Send test" });
  await openChat(page, id);

  await send(page, "ping 123");

  await expect(messages(page)).toHaveCount(2);
  await expect(messages(page).nth(0)).toContainText("ping 123");
  await expect(messages(page).nth(1)).toContainText("Mock reply (deterministic). You said: ping 123");
  await expect(regenerateButtons(page)).toHaveCount(1);
  await expect(composer(page)).toHaveValue("");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await expect(page.getByText("2 messages")).toBeVisible();

  const stored = await storedMessages(request, id);
  expect(stored.map((m) => [m.role, m.content])).toEqual([
    ["user", "ping 123"],
    ["assistant", "Mock reply (deterministic). You said: ping 123"],
  ]);
});

test("Shift+Enter adds a newline instead of sending", async ({ page, request }) => {
  await openChat(page, await createChat(request));
  await composer(page).fill("line one");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("line two");
  await expect(composer(page)).toHaveValue("line one\nline two");
  await expect(messages(page)).toHaveCount(0);
});

test("typing a slash opens the command list", async ({ page, request }) => {
  await openChat(page, await createChat(request));
  await composer(page).fill("/");
  await expect(page.getByText("Commands · ↑↓ to navigate")).toBeVisible();
  await expect(page.getByRole("button", { name: /\/compress/ })).toBeVisible();
});
