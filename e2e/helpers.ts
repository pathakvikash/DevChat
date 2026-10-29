import path from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const AUTH_FILE = path.join(__dirname, ".auth/user.json");

/** Creates a chat through the API (fast, and the sidebar title is set up front). Defaults to mock/echo. */
export async function createChat(
  request: APIRequestContext,
  opts: { title?: string; model?: string } = {},
): Promise<string> {
  const res = await request.post("/api/conversations", {
    data: { title: opts.title ?? "Sanity chat", model: opts.model ?? "mock/echo" },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id;
}

// networkidle: in dev, React Strict Mode loads the chat twice, and the second load
// replaces the message list. Sending before it lands loses messages (dev-only race).
export async function openChat(page: Page, id: string) {
  await page.goto(`/c/${id}`);
  await expect(composer(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
}

export const composer = (page: Page) => page.getByPlaceholder(/Type a message|Agent mode|Ask mode|Describe the task|Temporary chat\./);

/** Types into the composer and presses Enter. */
export async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await page.keyboard.press("Enter");
}

/** The reply is done streaming once its action buttons (hidden while streaming) appear. */
export const regenerateButtons = (page: Page) => page.getByRole("button", { name: "Regenerate message" });

export const messages = (page: Page) => page.locator("[data-message-id]");

/** Messages as the server stored them, in order. */
export async function storedMessages(request: APIRequestContext, id: string) {
  const res = await request.get(`/api/conversations/${id}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).messages as Array<{ id: string; role: string; content: string }>;
}

/** Removes every chat so list/visual specs start from a known sidebar. */
export async function deleteAllChats(request: APIRequestContext) {
  const list: Array<{ id: string }> = await (await request.get("/api/conversations")).json();
  for (const c of list) await request.delete(`/api/conversations/${c.id}`);
}
