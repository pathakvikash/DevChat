import path from "node:path";
import { rmSync, writeFileSync } from "node:fs";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { composer, createChat, openChat, regenerateButtons, storedMessages } from "./helpers";

// The same folder playwright.config.ts passes as SANITY_WORKING_FOLDER.
const FOLDER = path.join(__dirname, "fixtures/project");
const SECRET = path.join(FOLDER, ".env.local");

test.beforeAll(() => writeFileSync(SECRET, "API_TOKEN=do-not-send\n"));
test.afterAll(() => rmSync(SECRET, { force: true }));

async function chatInFolder(request: APIRequestContext, title: string) {
  const id = await createChat(request, { title });
  const res = await request.patch(`/api/conversations/${id}`, { data: { workingFolder: FOLDER } });
  expect(res.ok()).toBeTruthy();
  return id;
}

test("@ lists folder files, hides secrets, and sends the picked file's text", async ({ page, request }) => {
  const id = await chatInFolder(request, "Files test");
  await openChat(page, id);

  await composer(page).fill("summarize @");
  await expect(page.getByText("Files in project")).toBeVisible();
  await expect(page.getByRole("button", { name: /notes\.ts/ })).toBeVisible();
  await expect(page.getByText(".env.local")).toHaveCount(0);

  await composer(page).fill("summarize @notes");
  await page.keyboard.press("Enter"); // picks src/notes.ts; the @ text is removed from the box
  await expect(page.getByRole("button", { name: "Remove src/notes.ts" })).toBeVisible();
  await expect(composer(page)).toHaveValue("summarize ");

  await page.keyboard.press("End");
  await page.keyboard.type("this");
  await page.keyboard.press("Enter");

  await expect(regenerateButtons(page)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Remove src/notes.ts" })).toHaveCount(0);

  const user = (await storedMessages(request, id)).find((m) => m.role === "user");
  expect(user?.content).toContain("summarize this");
  expect(user?.content).toContain("File: src/notes.ts");
  expect(user?.content).toContain("export function greet(name: string)");
  expect(user?.content).not.toContain("do-not-send");
});

test("the files route refuses secrets, hidden and outside paths, and unknown chats", async ({ request }) => {
  const id = await chatInFolder(request, "Refusals");

  const list = await (await request.get(`/api/conversations/${id}/files`)).json();
  const paths = list.files.map((f: { path: string }) => f.path);
  expect(paths).toContain("src/notes.ts");
  expect(paths).not.toContain(".env.local");

  const secret = await request.get(`/api/conversations/${id}/files?path=${encodeURIComponent(".env.local")}`);
  expect(secret.status()).toBe(403);
  const outside = await request.get(
    `/api/conversations/${id}/files?path=${encodeURIComponent("../../../package.json")}`,
  );
  expect(outside.status()).toBe(403);
  expect((await request.get("/api/conversations/no-such-chat/files")).status()).toBe(404);
});

test("an @ inside an email address does not open the picker", async ({ page, request }) => {
  await openChat(page, await chatInFolder(request, "Email"));
  await composer(page).fill("write to dev@example.com");
  await expect(page.getByText("Files in project")).toHaveCount(0);
});

test("without a working folder, @ is plain text", async ({ page, request }) => {
  await openChat(page, await createChat(request, { title: "No folder" }));
  await composer(page).fill("hello @");
  await expect(page.getByText(/Files in /)).toHaveCount(0);
});
