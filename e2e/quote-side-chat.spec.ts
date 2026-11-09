import { test, expect, type APIRequestContext, type Page } from "./fixtures";
import { createChat, deleteAllChats, openChat, regenerateButtons, send, storedMessages } from "./helpers";

const pane = (page: Page, id: string) => page.locator(`[data-pane-id="${id}"]`);
const QUOTE = "You said: first topic";

// Selects `phrase` inside the pane's message `index` and fires the mouseup the pill waits for.
async function select(page: Page, paneId: string, index: number, phrase: string) {
  await page.evaluate(
    ([id, i, text]) => {
      (document.activeElement as HTMLElement | null)?.blur();
      const message = document.querySelectorAll(`[data-pane-id="${id}"] [data-message-id]`)[Number(i)];
      const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const at = n.textContent?.indexOf(text) ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(n, at);
        range.setEnd(n, at + text.length);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return;
      }
      throw new Error(`"${text}" not found`);
    },
    [paneId, String(index), phrase],
  );
}

async function sideIdOf(request: APIRequestContext, mainId: string): Promise<string> {
  const list = async () => (await (await request.get(`/api/conversations/${mainId}/children?kind=side`)).json()) as { id: string }[];
  await expect.poll(async () => (await list()).length, { message: "side chat created" }).toBeGreaterThan(0);
  return (await list())[0].id;
}

async function chatWithOneReply(page: Page, request: APIRequestContext) {
  const id = await createChat(request, { title: "Main plan" });
  await openChat(page, id);
  await send(page, "first topic");
  await expect(regenerateButtons(page)).toHaveCount(1);
  return id;
}

test.beforeEach(async ({ request }) => {
  await deleteAllChats(request);
});

test("the pill offers Start a side chat, Reply and a mic", async ({ page, request }) => {
  await page.addInitScript(() => {
    (window as any).webkitSpeechRecognition = class { start() {} stop() {} abort() {} };
  });
  const main = await chatWithOneReply(page, request);
  await select(page, main, 1, QUOTE);
  await expect(page.getByRole("button", { name: "Start a side chat about the selected text" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reply to selected text", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reply to selected text by voice" })).toBeVisible();
});

test("Start a side chat quotes the selection in the side box; sending stores quote + text there, not in main", async ({ page, request }) => {
  const main = await chatWithOneReply(page, request);
  await select(page, main, 1, QUOTE);
  await page.getByRole("button", { name: "Start a side chat about the selected text" }).click();

  const side = await sideIdOf(request, main);
  await expect(pane(page, side)).toBeVisible();
  await expect(pane(page, side).locator("blockquote")).toHaveText(QUOTE);
  await expect(pane(page, main).getByRole("list", { name: "Quotes" })).toHaveCount(0);

  const box = pane(page, side).getByRole("textbox", { name: "Message", exact: true });
  await box.fill("explain");
  await box.press("Enter");
  await expect(pane(page, side).locator("[data-message-id]")).toHaveCount(2);
  await expect.poll(async () => (await storedMessages(request, side))[0]?.content).toBe(`> ${QUOTE}\n\nexplain`);
  // Only the sent message's quote is left: the composer's one is cleared.
  await expect(pane(page, side).locator("blockquote")).toHaveCount(1);
  expect(await storedMessages(request, main)).toHaveLength(2);

  // In the side chat itself the pill has no side-chat option.
  await expect(pane(page, side).locator("[data-message-id]").nth(1)).toContainText("explain");
  await select(page, side, 1, "Mock reply");
  await expect(page.getByRole("button", { name: "Reply to selected text", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start a side chat about the selected text" })).toHaveCount(0);
});

test("the pill's mic adds a quote card and dictates into its instruction", async ({ page, request }) => {
  await page.addInitScript(() => {
    class FakeRecognition {
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      done = false;
      start() {
        if (this.done) return;
        this.done = true;
        setTimeout(() => {
          this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "spoken words", confidence: 1 } }] });
          this.onend?.();
        }, 50);
      }
      stop() {}
      abort() {}
    }
    (window as any).SpeechRecognition = FakeRecognition;
    (window as any).webkitSpeechRecognition = FakeRecognition;
  });
  const main = await chatWithOneReply(page, request);
  await select(page, main, 1, QUOTE);
  await page.getByRole("button", { name: "Reply to selected text by voice" }).click();
  await expect(page.getByLabel("Instruction for quote 1")).toHaveValue("spoken words");
});

test("a quote card's side-chat button moves the quote to the side chat", async ({ page, request }) => {
  const main = await chatWithOneReply(page, request);
  await select(page, main, 1, QUOTE);
  await page.getByRole("button", { name: "Reply to selected text", exact: true }).click();
  await page.getByLabel("Instruction for quote 1").fill("why");
  await page.getByRole("button", { name: "Ask quote 1 in a side chat" }).click();

  const side = await sideIdOf(request, main);
  await expect(pane(page, side).locator("blockquote")).toHaveText(QUOTE);
  await expect(pane(page, side).getByRole("textbox", { name: "Message", exact: true })).toHaveValue("why");
  await expect(page.getByLabel("Instruction for quote 1")).toHaveCount(0);
  await expect(pane(page, main).getByRole("list", { name: "Quotes" })).toHaveCount(0);
});

test("Reply inside a side chat replaces its quote, and the sent message has one quote", async ({ page, request }) => {
  const main = await chatWithOneReply(page, request);
  await select(page, main, 1, QUOTE);
  await page.getByRole("button", { name: "Start a side chat about the selected text" }).click();
  const side = await sideIdOf(request, main);
  const box = pane(page, side).getByRole("textbox", { name: "Message", exact: true });
  await box.fill("explain");
  await box.press("Enter");
  await expect(pane(page, side).locator("[data-message-id]").nth(1)).toContainText("explain");

  await select(page, side, 1, "Mock reply");
  await page.getByRole("button", { name: "Reply to selected text", exact: true }).click();
  await select(page, side, 1, "(deterministic)");
  await page.getByRole("button", { name: "Reply to selected text", exact: true }).click();
  // The sent message's quote plus the one in the composer.
  await expect(pane(page, side).locator("blockquote")).toHaveCount(2);
  await box.fill("x");
  await box.press("Enter");
  await expect.poll(async () => (await storedMessages(request, side))[2]?.content).toBe("> (deterministic)\n\nx");
});

test("when no pane can open, Start a side chat keeps the selection as a quote card in main", async ({ page, request }) => {
  const main = await chatWithOneReply(page, request);
  const other = await createChat(request, { title: "Other" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/c/${main}?split=${other}`);
  await expect(pane(page, other)).toBeVisible();
  await expect(pane(page, main).locator("[data-message-id]")).toHaveCount(2);
  await select(page, main, 1, QUOTE);
  await page.getByRole("button", { name: "Start a side chat about the selected text" }).click();
  await expect(pane(page, main).getByRole("list", { name: "Quotes" }).getByRole("listitem")).toHaveCount(1);
});
