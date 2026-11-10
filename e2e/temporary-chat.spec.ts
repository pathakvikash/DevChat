import { test, expect, type APIRequestContext, type Page } from "./fixtures";
import { createChat, openChat, regenerateButtons, send } from "./helpers";

const sidebarLink = (page: Page, id: string) => page.locator(`a[href="/c/${id}"]`);
const toggle = (page: Page) => page.getByRole("button", { name: "Temporary chat", exact: true });
const listedIds = async (request: APIRequestContext) =>
  ((await (await request.get("/api/conversations")).json()) as Array<{ id: string }>).map((c) => c.id);
const exists = async (request: APIRequestContext, id: string) => (await request.get(`/api/conversations/${id}`)).ok();

test("a temporary chat from the palette is marked, unlisted, and deleted on New Chat", async ({ page, request }) => {
  const first = await createChat(request);
  await openChat(page, first);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("option", { name: /new temporary chat/i }).click();
  await page.waitForURL((url) => /^\/c\/[a-z0-9]+$/.test(url.pathname) && !url.pathname.endsWith(first));
  const id = new URL(page.url()).pathname.split("/").pop()!;

  await expect(page.getByRole("heading", { level: 1, name: "Temporary chat" })).toBeVisible();
  await expect(page.getByText("Temporary chat · deleted when you leave")).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");

  await page.waitForLoadState("networkidle");
  await send(page, "temporary note");
  await expect(regenerateButtons(page)).toHaveCount(1);
  await expect(sidebarLink(page, id)).toHaveCount(0);
  expect(await listedIds(request)).not.toContain(id);
  expect(await exists(request, id)).toBe(true);

  // The sidebar's New Chat reloads the page, so it announces the leave and deletes at once.
  await page.getByRole("button", { name: "New Chat" }).click();
  await page.waitForURL((url) => /^\/c\/[a-z0-9]+$/.test(url.pathname) && !url.pathname.endsWith(id));
  await expect.poll(() => exists(request, id)).toBe(false);
});

test("the header toggle makes an empty chat temporary, and leaving for another chat deletes it", async ({ page, request }) => {
  const other = await createChat(request, { title: "Other chat" });
  const id = await createChat(request, { title: "Toggle temp chat" });
  await openChat(page, id);
  await expect(sidebarLink(page, id)).toBeVisible();

  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Temporary chat · deleted when you leave")).toBeVisible();
  await expect(sidebarLink(page, id)).toHaveCount(0);

  await send(page, "temporary note");
  await expect(regenerateButtons(page)).toHaveCount(1);
  await expect(toggle(page)).toBeHidden(); // only an empty chat can be switched
  await expect(sidebarLink(page, id)).toHaveCount(0);
  expect(await listedIds(request)).not.toContain(id);
  expect(await listedIds(request)).toContain(other);

  // Client-side navigation has a short grace period before the delete.
  await sidebarLink(page, other).click();
  await expect(page).toHaveURL(new RegExp(`/c/${other}$`));
  await expect.poll(() => exists(request, id), { timeout: 10_000 }).toBe(false);
  expect(await exists(request, other)).toBe(true);
});
