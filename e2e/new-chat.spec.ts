import { test, expect } from "./fixtures";
import { composer, regenerateButtons } from "./helpers";

test("New Chat in the sidebar opens an empty chat on the default model", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "New Chat" }).click();
  await expect(page).toHaveURL(/\/c\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: "Start the conversation" })).toBeVisible();
  await expect(page.getByText("Currently using")).toContainText("echo");
  await expect(page.getByText("0 messages")).toBeVisible();
});

test("/c/new creates a chat and redirects into it", async ({ page }) => {
  await page.goto("/c/new");
  await expect(page).toHaveURL(/\/c\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: "Start the conversation" })).toBeVisible();
  await expect(composer(page)).toBeVisible();
});

test("a prompt typed on the home page starts a chat and gets a reply", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("hello from home");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/c\/[a-z0-9]+(\?q=.*)?$/);
  await expect(page.getByText("You said: hello from home")).toBeVisible();
  await expect(regenerateButtons(page)).toHaveCount(1);
});
