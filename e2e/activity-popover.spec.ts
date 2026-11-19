import { test, expect, type Page } from "./fixtures";
import { createChat, deleteAllChats, messages, openChat, send } from "./helpers";

const activity = (page: Page) => page.getByRole("button", { name: /^Activity/ });
const popover = (page: Page) => page.getByRole("dialog", { name: "Activity" });
// A docked panel is an aside (complementary); in a narrow pane it is a modal sheet with the dialog role.
const panel = (page: Page) => page.locator('aside[aria-label="Chat panel"]');

test.beforeEach(({ request }) => deleteAllChats(request));

test("the Activity popover opens from the header and closes with Escape, returning focus", async ({ page, request }) => {
  await openChat(page, await createChat(request));

  await expect(activity(page)).toHaveAttribute("aria-haspopup", "dialog");
  await expect(activity(page)).toHaveAttribute("aria-expanded", "false");
  await activity(page).click();
  await expect(popover(page)).toBeVisible();
  await expect(activity(page)).toHaveAttribute("aria-expanded", "true");
  for (const section of ["Environment", "Context", "Connectors", "Outputs", "Background tasks"]) {
    await expect(popover(page).getByRole("region", { name: section })).toBeVisible();
  }
  // Focus lands on the first row.
  await expect(popover(page).getByRole("button", { name: /^Model/ })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(popover(page)).toBeHidden();
  await expect(activity(page)).toBeFocused();

  // An outside click closes it too.
  await activity(page).click();
  await expect(popover(page)).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(popover(page)).toBeHidden();
});

test("the Context row opens the context view in the side panel", async ({ page, request }) => {
  await openChat(page, await createChat(request));
  await activity(page).click();
  await popover(page).getByRole("button", { name: /^Context used/ }).click();

  await expect(popover(page)).toBeHidden();
  await expect(page).toHaveURL(/panel=context/);
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("tab", { name: "Context" })).toHaveAttribute("aria-selected", "true");
  await expect(panel(page).getByRole("heading", { name: "Context Details" })).toBeVisible();
});

test("an Outputs row opens that artifact in the panel", async ({ page, request }) => {
  const id = await createChat(request, { title: "Has outputs" });
  const make = async (title: string, content: string) => {
    const res = await request.post(`/api/conversations/${id}/artifacts`, { data: { type: "document", title, content } });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).id as string;
  };
  await make("Older notes", "first body");
  const wanted = await make("Launch plan", "plan body text");
  await openChat(page, id);

  await activity(page).click();
  const row = popover(page).getByRole("region", { name: "Outputs" }).getByRole("button", { name: /Launch plan/ });
  await expect(row).toBeVisible();
  await row.click();

  await expect(page).toHaveURL(new RegExp(`panel=outputs&item=${wanted}`));
  await expect(panel(page).getByText("plan body text")).toBeVisible();
});

test("the Memory switch persists after a reload", async ({ page, request }) => {
  await openChat(page, await createChat(request));
  await activity(page).click();
  const memory = popover(page).getByRole("switch", { name: /Memory/ });
  await expect(memory).toHaveAttribute("aria-checked", "true");
  await memory.click();
  await expect(memory).toHaveAttribute("aria-checked", "false");

  await page.reload();
  await page.waitForLoadState("networkidle");
  await activity(page).click();
  await expect(popover(page).getByRole("switch", { name: /Memory/ })).toHaveAttribute("aria-checked", "false");
});

test("a running reply is a task row, and Stop reply ends it", async ({ page, request }) => {
  const id = await createChat(request, { title: "Slow one", model: "mock/slow" });
  await openChat(page, id);
  await send(page, "go slow");
  await expect(messages(page).nth(1)).toContainText("slow-3");

  await activity(page).click();
  const row = popover(page).locator('[data-task-kind="reply"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText("Replying");
  await row.getByRole("button", { name: "Stop reply" }).click();

  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await expect(row).toBeHidden();
  await expect(popover(page).getByText("Nothing running")).toBeVisible();
});
