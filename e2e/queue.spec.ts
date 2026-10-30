import { test, expect, type Page } from "./fixtures";
import { composer, createChat, messages, openChat, storedMessages } from "./helpers";

const queued = (page: Page) => page.getByRole("list", { name: "Queued messages" });
const stop = (page: Page) => page.getByRole("button", { name: "Stop", exact: true });

test("a message typed during a tool step reaches the model between steps", async ({ page, request }) => {
  const id = await createChat(request, { title: "Queue tool", model: "mock/tool" });
  await openChat(page, id);

  await composer(page).fill("what is 6 times 7?");
  await page.keyboard.press("Enter");
  await expect(stop(page)).toBeVisible();

  await composer(page).fill("queued: make it 7 times 7");
  await expect(page.getByText("Enter queues · the model sees it at its next step")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(queued(page)).toContainText("make it 7 times 7");
  await expect(composer(page)).toHaveValue("");

  // Shown as its own bubble between the tool step and the answer, and the chip is gone.
  await expect(page.getByText("Sent while replying")).toBeVisible({ timeout: 15_000 });
  await expect(messages(page).nth(2)).toContainText("make it 7 times 7");
  await expect(messages(page).nth(3)).toContainText("The calculator returned 42");
  await expect(queued(page)).toHaveCount(0);

  // Stored as one reply that carries the queued text, and the same layout after a reload.
  await expect.poll(async () => (await storedMessages(request, id)).length).toBe(2);
  expect((await storedMessages(request, id))[1].content).toContain("make it 7 times 7");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(messages(page).nth(2)).toContainText("make it 7 times 7");
  await expect(messages(page).nth(3)).toContainText("The calculator returned 42");
});

test("a message typed during a one-step reply is sent as the next message", async ({ page, request }) => {
  const id = await createChat(request, { title: "Queue slow", model: "mock/slow" });
  await openChat(page, id);

  await composer(page).fill("go slow");
  await page.keyboard.press("Enter");
  await expect(stop(page)).toBeVisible();

  await composer(page).fill("then this");
  await page.keyboard.press("Enter");
  await expect(queued(page)).toContainText("then this");

  // The reply has no later step, so the queued text goes out as the next message once it ends.
  await expect
    .poll(async () => (await storedMessages(request, id)).map((m) => m.role), { timeout: 30_000 })
    .toEqual(["user", "assistant", "user", "assistant"]);
  expect((await storedMessages(request, id))[2].content).toBe("then this");
  await expect(queued(page)).toHaveCount(0);
});

test("Stop puts an undelivered message back in the input box", async ({ page, request }) => {
  const id = await createChat(request, { title: "Queue stop", model: "mock/slow" });
  await openChat(page, id);

  await composer(page).fill("go slow");
  await page.keyboard.press("Enter");
  await expect(stop(page)).toBeVisible();

  await composer(page).fill("keep this");
  await page.keyboard.press("Enter");
  await expect(queued(page)).toContainText("keep this");

  await stop(page).click();
  await expect(composer(page)).toHaveValue("keep this");
  await expect(queued(page)).toHaveCount(0);
  expect((await (await request.get(`/api/conversations/${id}/queue`)).json()).queued).toEqual([]);
});

test("a reload brings back a queued message the reply never took", async ({ page, request }) => {
  const id = await createChat(request, { title: "Queue reload", model: "mock/slow" });
  await openChat(page, id);

  await composer(page).fill("go slow");
  await page.keyboard.press("Enter");
  await expect(stop(page)).toBeVisible();

  await composer(page).fill("keep this too");
  await page.keyboard.press("Enter");
  await expect(queued(page)).toContainText("keep this too");
  // The chip shows before the server has it. Wait until the server stores it, or the reload can cut the POST short.
  await expect.poll(async () => (await (await request.get(`/api/conversations/${id}/queue`)).json()).queued.length).toBe(1);

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(composer(page)).toHaveValue("keep this too");
  expect((await (await request.get(`/api/conversations/${id}/queue`)).json()).queued).toEqual([]);
});
