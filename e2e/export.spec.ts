import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { createChat, openChat, regenerateButtons, send } from "./helpers";

async function chatWithOneReply(page: Page, request: Parameters<typeof createChat>[0]) {
  await openChat(page, await createChat(request, { title: "Export notes" }));
  await send(page, "export me please");
  await expect(regenerateButtons(page)).toHaveCount(1);
}

async function expectMarkdownDownload(page: Page, download: import("@playwright/test").Download) {
  expect(download.suggestedFilename()).toBe("Export notes.md");
  const body = readFileSync((await download.path())!, "utf8");
  expect(body).toContain("# Export notes");
  expect(body).toContain("### User\n\nexport me please");
  expect(body).toContain("You said: export me please");
  await expect(page.getByText('Exported "Export notes.md"', { exact: true })).toBeVisible(); // toast
}

test("/export downloads the chat as Markdown", async ({ page, request }) => {
  await chatWithOneReply(page, request);

  const download = page.waitForEvent("download");
  await send(page, "/export "); // trailing space: without it Enter only completes the command name
  await expectMarkdownDownload(page, await download);
});

test('the palette\'s "Export as Markdown" downloads the same file', async ({ page, request }) => {
  await chatWithOneReply(page, request);

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const download = page.waitForEvent("download");
  await palette.getByRole("option", { name: "Export as Markdown" }).click();
  await expectMarkdownDownload(page, await download);
  await expect(palette).toBeHidden();
});
