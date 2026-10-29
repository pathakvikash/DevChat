import { test, expect, type Page } from "@playwright/test";
import { composer, createChat, messages, openChat, regenerateButtons, send } from "./helpers";

// Trailing space: without it Enter only completes the command name.
async function runCompress(page: Page) {
  await composer(page).fill("/compress ");
  await page.keyboard.press("Enter");
}

test("/compress summarizes the chat with mock/summary and says so", async ({ page, request }) => {
  const id = await createChat(request, { title: "Compress test" });
  await openChat(page, id);
  await send(page, "first topic");
  await expect(regenerateButtons(page)).toHaveCount(1);
  await send(page, "second topic");
  await expect(regenerateButtons(page)).toHaveCount(2);

  await runCompress(page);

  await expect(page.getByText("Conversation compressed", { exact: true })).toBeVisible(); // toast
  await expect(page.getByText("Session compressed — using summary for context.")).toBeVisible();
  await expect(composer(page)).toHaveValue("");
  // The transcript now opens with the compression card; the full history stays in the database.
  await expect(messages(page).first()).toContainText("4 messages summarized");

  const chat = await (await request.get(`/api/conversations/${id}`)).json();
  expect(chat.compressedSummary).toContain("Mock summary of the conversation");
  expect(chat.compressedBeforeMessages).toBe(4);
  expect(chat.messages).toHaveLength(4);
});

test("the chat keeps working after compression", async ({ page, request }) => {
  const id = await createChat(request);
  await openChat(page, id);
  await send(page, "before compress");
  await expect(regenerateButtons(page)).toHaveCount(1);
  await runCompress(page);
  await expect(page.getByText("Session compressed — using summary for context.")).toBeVisible();

  await composer(page).fill("after compress");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("You said: after compress")).toBeVisible();
});

// Known bug: ChatInput only releases its Enter-key submit lock when a reply finishes streaming,
// so after a command that never streams (like /compress) Enter does nothing until you click Send.
// When this is fixed the test starts passing, test.fail() complains, and the line can go.
test.fail("Enter still sends after a slash command (known bug)", async ({ page, request }) => {
  await openChat(page, await createChat(request));
  await runCompress(page); // no messages yet: nothing to compress, but the command still submits
  await expect(composer(page)).toHaveValue("");

  await send(page, "after command");
  await expect(page.getByText("You said: after command")).toBeVisible({ timeout: 3000 });
});
