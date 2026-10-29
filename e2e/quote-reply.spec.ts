import { test, expect, type Page } from "@playwright/test";
import { composer, createChat, messages, openChat, regenerateButtons, send, storedMessages } from "./helpers";

const replyButton = (page: Page) => page.getByRole("button", { name: "Reply to selected text" });

// Selects `phrase` inside message `index` and fires the mouseup the Reply pill waits for.
async function select(page: Page, index: number, phrase: string) {
  await page.evaluate(
    ([i, text]) => {
      const walker = document.createTreeWalker(document.querySelectorAll("[data-message-id]")[Number(i)], NodeFilter.SHOW_TEXT);
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
      throw new Error(`"${text}" not found in message ${i}`);
    },
    [String(index), phrase],
  );
}

async function chatWithOneReply(page: Page, request: Parameters<typeof createChat>[0]) {
  const id = await createChat(request, { title: "Quote reply" });
  await openChat(page, id);
  await send(page, "first topic");
  await expect(regenerateButtons(page)).toHaveCount(1);
  return id;
}

test("Cmd/Ctrl+Enter in a quote card sends that quote and its instruction, and keeps the typed draft", async ({ page, request }) => {
  const id = await chatWithOneReply(page, request);
  await composer(page).fill("draft stays");

  await select(page, 1, "You said: first topic");
  await replyButton(page).click();
  const instruction = page.getByLabel("Instruction for quote 1");
  await expect(instruction).toBeFocused();
  await instruction.fill("make it shorter");
  await page.keyboard.press("ControlOrMeta+Enter");

  await expect(regenerateButtons(page)).toHaveCount(2);
  await expect.poll(async () => (await storedMessages(request, id)).length).toBe(4);
  const stored = await storedMessages(request, id);
  expect(stored.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  expect(stored[2].content).toBe("> You said: first topic\n\nmake it shorter");

  await expect(messages(page).nth(2).locator("blockquote")).toHaveText("You said: first topic");
  await expect(messages(page).nth(2)).toContainText("make it shorter");
  await expect(instruction).toHaveCount(0);
  await expect(composer(page)).toHaveValue("draft stays");
});

test("two quote cards plus typed text go out as one message on Enter", async ({ page, request }) => {
  const id = await chatWithOneReply(page, request);

  await select(page, 1, "You said: first topic");
  await replyButton(page).click();
  await select(page, 1, "Mock reply (deterministic).");
  await replyButton(page).click();
  await expect(page.getByRole("list", { name: "Quotes" }).getByRole("listitem")).toHaveCount(2);
  await page.getByLabel("Instruction for quote 1").fill("explain this");
  await composer(page).fill("and be brief");
  await page.keyboard.press("Enter");

  await expect(regenerateButtons(page)).toHaveCount(2);
  await expect.poll(async () => (await storedMessages(request, id)).length).toBe(4);
  const stored = await storedMessages(request, id);
  expect(stored[2].role).toBe("user");
  expect(stored[2].content).toBe(
    "> You said: first topic\n\nexplain this\n\n> Mock reply (deterministic).\n\nand be brief",
  );
  await expect(page.getByRole("list", { name: "Quotes" })).toHaveCount(0);
  await expect(composer(page)).toHaveValue("");
});
