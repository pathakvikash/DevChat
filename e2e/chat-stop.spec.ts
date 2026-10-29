import { test, expect } from "@playwright/test";
import { composer, createChat, messages, openChat, send, storedMessages } from "./helpers";

test("Stop ends a streaming reply early and keeps what arrived", async ({ page, request }) => {
  const id = await createChat(request, { title: "Stop test", model: "mock/slow" });
  await openChat(page, id);

  await send(page, "go slow");
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible();
  await expect(messages(page).nth(1)).toContainText("slow-3");

  await stop.click();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await expect(composer(page)).toBeEnabled();

  // The full reply runs ~7s and ends with slow-60; after Stop it must not keep growing.
  await page.waitForTimeout(1500);
  await expect(messages(page).nth(1)).not.toContainText("slow-60");
  const shown = await messages(page).nth(1).innerText();
  await page.waitForTimeout(1000);
  expect(await messages(page).nth(1).innerText()).toBe(shown);

  // The partial reply is stored, so a reload still shows it.
  await expect.poll(async () => (await storedMessages(request, id)).length).toBe(2);
  const [, partial] = await storedMessages(request, id);
  expect(partial.content).toContain("slow-3");
  expect(partial.content).not.toContain("slow-60");
  await page.reload();
  await expect(messages(page).nth(1)).toContainText("slow-3");
});
