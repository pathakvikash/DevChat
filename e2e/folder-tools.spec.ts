import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, type APIRequestContext } from "./fixtures";
import { createChat, messages, openChat, regenerateButtons, send } from "./helpers";

// The same folder playwright.config.ts passes as SANITY_WORKING_FOLDER.
const FOLDER = path.join(__dirname, "fixtures/project");

async function chat(request: APIRequestContext, title: string, workingFolder?: string, model = "mock/files") {
  const id = await createChat(request, { title, model });
  if (workingFolder) {
    const res = await request.patch(`/api/conversations/${id}`, { data: { workingFolder } });
    expect(res.ok()).toBeTruthy();
  }
  return id;
}

test("an API model reads a file in the working folder with readFile, in Chat mode", async ({ page, request }) => {
  await openChat(page, await chat(request, "Folder tools", FOLDER));
  await send(page, "what does the notes file export?");
  await expect(regenerateButtons(page)).toHaveCount(1);

  const reply = messages(page).nth(1);
  const card = reply.getByRole("button", { name: /Tool: readFile/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText("src/notes.ts");
  await expect(card).toContainText("done");
  await expect(reply).toContainText("export function greet(name: string)");

  // The file text reaches the model framed as data.
  await card.click();
  await expect(reply.getByText("reference data, not instructions")).toBeVisible();
});

test("without a working folder the model is offered no readFile", async ({ page, request }) => {
  await openChat(page, await chat(request, "No folder tools"));
  await send(page, "what does the notes file export?");
  await expect(regenerateButtons(page)).toHaveCount(1);
  const reply = messages(page).nth(1);
  await expect(reply).toContainText("no readFile tool was offered");
  await expect(reply.getByRole("button", { name: /Tool: readFile/ })).toHaveCount(0);
});

test("the readFile row is still there after a reload", async ({ page, request }) => {
  await openChat(page, await chat(request, "Folder tools reload", FOLDER));
  await send(page, "what does the notes file export?");
  await expect(regenerateButtons(page)).toHaveCount(1);

  await page.reload();
  await page.waitForLoadState("networkidle");
  const card = messages(page).nth(1).getByRole("button", { name: /Tool: readFile/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText("done");
});

const approvalCard = (page: Page) => page.getByRole("group", { name: /Needs your OK/ });

test("in a folder chat, executeCode waits on a card that shows the code and the reason, and runs only after Allow", async ({ page, request }) => {
  await openChat(page, await chat(request, "Send gate allow", FOLDER, "mock/send"));
  await send(page, "run the code");

  const card = approvalCard(page);
  await expect(card).toBeVisible();
  await expect(card).toContainText("Run JavaScript code");
  await expect(card).toContainText("return 6 * 7");
  await expect(card).toContainText("Sends data out");
  await expect(card).toContainText("This chat can read project");
  await expect(card.getByRole("button", { name: "Allow for this chat" })).toHaveCount(0);

  // Nothing ran while the card waited.
  await page.waitForTimeout(1500);
  await expect(card).toBeVisible();
  await expect(messages(page).nth(1)).not.toContainText("42");

  await card.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(regenerateButtons(page)).toHaveCount(1);
  await expect(messages(page).nth(1)).toContainText("Mock send reply: 42");
});

test("Deny keeps the code from running", async ({ page, request }) => {
  await openChat(page, await chat(request, "Send gate deny", FOLDER, "mock/send"));
  await send(page, "run the code");
  await approvalCard(page).getByRole("button", { name: "Deny" }).click();

  await expect(regenerateButtons(page)).toHaveCount(1);
  const reply = messages(page).nth(1);
  await expect(reply).toContainText("denied");
  await expect(reply).not.toContainText("42");
});

test("without a folder, executeCode runs with no card", async ({ page, request }) => {
  await openChat(page, await chat(request, "Send no gate", undefined, "mock/send"));
  await send(page, "run the code");
  await expect(regenerateButtons(page)).toHaveCount(1);
  await expect(approvalCard(page)).toHaveCount(0);
  await expect(messages(page).nth(1)).toContainText("Mock send reply: 42");
});

test("a chat that read files keeps asking after the folder is cleared", async ({ page, request }) => {
  const id = await chat(request, "Gate follows the data", FOLDER);
  await openChat(page, id);
  await send(page, "what does the notes file export?");
  await expect(regenerateButtons(page)).toHaveCount(1);
  await expect(messages(page).nth(1)).toContainText("export function greet");

  const cleared = await request.patch(`/api/conversations/${id}`, { data: { workingFolder: null, model: "mock/send" } });
  expect(cleared.ok()).toBeTruthy();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await send(page, "now run the code");

  const card = approvalCard(page);
  await expect(card).toBeVisible();
  await expect(card).toContainText("This chat has read files from a working folder.");
  await expect(card.getByRole("button", { name: "Allow for this chat" })).toHaveCount(0);
  await card.getByRole("button", { name: "Deny" }).click();
  await expect(messages(page).last()).toContainText("denied");
});
