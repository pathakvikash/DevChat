import { test as setup, expect } from "@playwright/test";
import { AUTH_FILE, createChat } from "./helpers";

setup("sign in as the test user and warm up the server", async ({ page }) => {
  setup.setTimeout(240_000);

  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in as test user" }).click();
  await page.waitForURL("/");
  // New chats made from the UI should use a mock model, never a real one.
  const res = await page.request.put("/api/settings/keys", { data: { defaultModel: "mock/echo" } });
  expect(res.ok()).toBeTruthy();
  await page.context().storageState({ path: AUTH_FILE });

  // The first hit on each dev-server route compiles it; pay that once here instead of inside a spec.
  const id = await createChat(page.request, { title: "Warm-up" });
  await page.goto(`/c/${id}`);
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("warm up");
  await page.keyboard.press("Enter");
  await expect(page.getByText("You said: warm up")).toBeVisible({ timeout: 120_000 });
  for (const route of ["/settings", "/memory", "/kb"]) await page.goto(route);
  await page.request.delete(`/api/conversations/${id}`);
});
