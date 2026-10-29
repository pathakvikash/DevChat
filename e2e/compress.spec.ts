import { test, expect, type Page } from "@playwright/test";
import { composer, createChat, messages, openChat, regenerateButtons, send, storedMessages } from "./helpers";

const COMPRESS_URL = "**/api/conversations/*/compress";

// Trailing space: without it Enter only completes the command name.
async function runCompress(page: Page, focus = "") {
  await composer(page).fill(`/compress ${focus}`);
  await page.keyboard.press("Enter");
}

// Compressing cuts at the newest user message, so it needs two exchanges to have anything to drop.
async function twoExchanges(page: Page) {
  await send(page, "first topic");
  await expect(regenerateButtons(page)).toHaveCount(1);
  await send(page, "second topic");
  await expect(regenerateButtons(page)).toHaveCount(2);
}

/** Holds each compress call for a moment so the status row can be seen; returns the focus values it saw. */
async function slowCompress(page: Page) {
  const focuses: unknown[] = [];
  await page.route(COMPRESS_URL, async (route) => {
    focuses.push(route.request().postDataJSON()?.focus);
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  return focuses;
}

test("/compress summarizes the chat with mock/summary and says so", async ({ page, request }) => {
  const id = await createChat(request, { title: "Compress test" });
  await openChat(page, id);
  await twoExchanges(page);

  await runCompress(page);

  await expect(page.getByText("Chat compressed", { exact: true })).toBeVisible(); // toast
  await expect(page.getByText("Session compressed — using summary for context.")).toBeVisible();
  await expect(composer(page)).toHaveValue("");
  // The transcript opens with the compression card; the newest exchange stays live, the full history stays stored.
  await expect(messages(page).first()).toContainText("2 messages summarized");

  const chat = await (await request.get(`/api/conversations/${id}`)).json();
  expect(chat.compressedSummary).toContain("Mock summary of the conversation");
  expect(chat.compressedBeforeMessages).toBe(2);
  expect(chat.messages).toHaveLength(4);
});

test("the chat keeps working after compression", async ({ page, request }) => {
  const id = await createChat(request);
  await openChat(page, id);
  await twoExchanges(page);
  await runCompress(page);
  await expect(page.getByText("Session compressed — using summary for context.")).toBeVisible();

  await composer(page).fill("after compress");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("You said: after compress")).toBeVisible();
});

test("/compress with only one exchange says there is nothing to compress", async ({ page, request }) => {
  const id = await createChat(request);
  await openChat(page, id);
  await send(page, "only topic");
  await expect(regenerateButtons(page)).toHaveCount(1);

  await runCompress(page);

  await expect(page.getByText("Nothing to compress yet", { exact: true })).toBeVisible();
  await expect(page.getByText("Session compressed — using summary for context.")).toBeHidden();
  expect(await storedMessages(request, id)).toHaveLength(2);
  expect((await (await request.get(`/api/conversations/${id}`)).json()).compressedSummary).toBeNull();
});

test("/compress with a focus shows what it keeps while it runs", async ({ page, request }) => {
  const id = await createChat(request);
  await openChat(page, id);
  await twoExchanges(page);
  const focuses = await slowCompress(page);

  await runCompress(page, "keep pineapple");

  await expect(page.getByText('Compressing chat, keeping "keep pineapple"…', { exact: true })).toBeVisible();
  await expect(page.getByText("Chat compressed", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Compressing chat/)).toBeHidden();
  expect(focuses).toEqual(["keep pineapple"]);
  const chat = await (await request.get(`/api/conversations/${id}`)).json();
  expect(chat.compressedSummary).toContain("Mock summary of the conversation");
});

test("a long focus is cut at 40 characters in the status row", async ({ page, request }) => {
  await openChat(page, await createChat(request));
  await twoExchanges(page);
  await slowCompress(page);

  const focus = "abcdefghij".repeat(5);
  await runCompress(page, focus);

  await expect(page.getByText(`Compressing chat, keeping "${focus.slice(0, 40)}…"…`, { exact: true })).toBeVisible();
  await expect(page.getByText("Chat compressed", { exact: true })).toBeVisible();
});

test("/compress while a reply is streaming waits and compresses nothing", async ({ page, request }) => {
  const id = await createChat(request, { title: "Compress while streaming", model: "mock/slow" });
  await openChat(page, id);
  let calls = 0;
  await page.route(COMPRESS_URL, (route) => {
    calls++;
    return route.continue();
  });

  await send(page, "go slow");
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible();

  await send(page, "/compress ");

  await expect(page.getByText("Wait for the reply to finish, then compress", { exact: true })).toBeVisible();
  await expect(composer(page)).toHaveValue("/compress ");
  expect(calls).toBe(0);

  await stop.click();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  expect((await (await request.get(`/api/conversations/${id}`)).json()).compressedSummary).toBeNull();
});
