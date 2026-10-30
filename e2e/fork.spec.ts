import { test, expect, type Page } from "./fixtures";
import { createChat, messages, openChat, regenerateButtons, send, storedMessages } from "./helpers";

// Replies are stored only after a reload (see message-actions.spec.ts), and fork copies stored messages.
async function askAndReload(page: Page, text: string, replies: number) {
  await send(page, text);
  await expect(regenerateButtons(page)).toHaveCount(replies);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(messages(page)).toHaveCount(replies * 2);
}

const forkedFromLine = (page: Page) => page.locator("span").filter({ hasText: "Forked from" });

test("Fork from here opens a copy with the messages up to that reply", async ({
  page,
  request,
}) => {
  const id = await createChat(request, { title: "Fork source" });
  await openChat(page, id);
  await askAndReload(page, "alpha question", 1);
  await askAndReload(page, "beta question", 2);
  const original = await storedMessages(request, id);
  expect(original).toHaveLength(4);

  await messages(page).nth(1).getByRole("button", { name: "Fork from here" }).click();
  await page.waitForURL(
    (url) => url.pathname.startsWith("/c/") && !url.pathname.endsWith(`/${id}`),
  );
  const forkId = new URL(page.url()).pathname.split("/").pop()!;

  // The copy opens with the first exchange only, and says where it came from.
  await expect(messages(page)).toHaveCount(2);
  await expect(messages(page).nth(0)).toContainText("alpha question");
  await expect(messages(page).nth(1)).toContainText("You said: alpha question");
  await expect(forkedFromLine(page).getByRole("link", { name: "Fork source" })).toHaveAttribute(
    "href",
    `/c/${id}`,
  );

  // Stored: new ids, same text, same order, linked to the original.
  const copy = await (await request.get(`/api/conversations/${forkId}`)).json();
  expect(copy).toMatchObject({
    title: "Fork source (fork)",
    model: "mock/echo",
    forkedFromId: id,
  });
  const forkStored = await storedMessages(request, forkId);
  expect(forkStored.map((m) => m.content)).toEqual(original.slice(0, 2).map((m) => m.content));
  expect(forkStored.map((m) => m.id)).not.toContain(original[0].id);

  // The toast links back to the original, which is unchanged.
  await expect(page.getByText("Forked this chat")).toBeVisible();
  await page.getByRole("link", { name: "Open original" }).click();
  await page.waitForURL(`**/c/${id}`);
  await expect(messages(page)).toHaveCount(4);
  await expect(forkedFromLine(page)).toHaveCount(0);
  expect(await storedMessages(request, id)).toHaveLength(4);
});

test("Fork works on a reply sent in this session, without a reload", async ({ page, request }) => {
  const id = await createChat(request, { title: "Fresh source" });
  await openChat(page, id);
  await send(page, "fresh question");
  await expect(regenerateButtons(page)).toHaveCount(1);

  // No reload: the reply's id on screen is the one the server saved it under.
  await messages(page).nth(1).getByRole("button", { name: "Fork from here" }).click();
  await page.waitForURL(
    (url) => url.pathname.startsWith("/c/") && !url.pathname.endsWith(`/${id}`),
  );
  const forkId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(messages(page)).toHaveCount(2);
  await expect(messages(page).nth(1)).toContainText("You said: fresh question");
  expect((await storedMessages(request, forkId)).map((m) => m.content)).toEqual(
    (await storedMessages(request, id)).map((m) => m.content),
  );
});

test("Deleting the original keeps the fork and drops the Forked from line", async ({
  page,
  request,
}) => {
  const id = await createChat(request, { title: "Doomed source" });
  await openChat(page, id);
  await askAndReload(page, "keep this", 1);

  await messages(page).nth(1).getByRole("button", { name: "Fork from here" }).click();
  await page.waitForURL(
    (url) => url.pathname.startsWith("/c/") && !url.pathname.endsWith(`/${id}`),
  );
  const forkId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(forkedFromLine(page)).toBeVisible();

  expect((await request.delete(`/api/conversations/${id}`)).ok()).toBeTruthy();
  await openChat(page, forkId);
  await expect(messages(page)).toHaveCount(2);
  await expect(messages(page).nth(0)).toContainText("keep this");
  await expect(forkedFromLine(page)).toHaveCount(0);
});

test("Forking a temporary chat makes a saved chat and the temporary one is still deleted when left", async ({
  page,
  request,
}) => {
  const res = await request.post("/api/conversations", {
    data: { title: "Temp source", model: "mock/echo", temporary: true },
  });
  expect(res.status()).toBe(201);
  const tempId = (await res.json()).id;
  await openChat(page, tempId);
  await askAndReload(page, "temporary question", 1);

  await messages(page).nth(1).getByRole("button", { name: "Fork from here" }).click();
  await page.waitForURL(
    (url) => url.pathname.startsWith("/c/") && !url.pathname.endsWith(`/${tempId}`),
  );
  const forkId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(messages(page)).toHaveCount(2);
  // No "Forked from" line: the temporary source is deleted when left, so there is no link back.
  await expect(forkedFromLine(page)).toHaveCount(0);

  // The copy is saved, with memory on, and still records its source.
  const copy = await (await request.get(`/api/conversations/${forkId}`)).json();
  expect(copy).toMatchObject({ temporary: false, memoryDisabled: false, forkedFromId: tempId });
  await expect(page.getByRole("link", { name: "Open original" })).toHaveCount(0);

  // The temporary chat is deleted once it has been left for the grace period.
  await expect
    .poll(async () => (await request.get(`/api/conversations/${tempId}`)).status(), {
      timeout: 15000,
    })
    .toBe(404);
});
