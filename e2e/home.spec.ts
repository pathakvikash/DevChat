import { test, expect } from "./fixtures";
import { composer } from "./helpers";

test("the prompt is in the first viewport and Enter starts a chat", async ({ page }) => {
  await page.goto("/");
  await expect(composer(page)).toBeInViewport();
  await composer(page).fill("hello tour");
  await page.keyboard.press("Enter");
  // /c/new redirects into the new chat and keeps the query.
  await expect(page).toHaveURL(/\/c\/[a-z0-9]+\?q=hello(%20|\+)tour$/);
});

test("a section reveals when scrolled into view", async ({ page }) => {
  await page.goto("/");
  const heading = page.getByRole("heading", { name: "More than a chat box." });
  await heading.scrollIntoViewIfNeeded();
  await expect(heading.locator("xpath=..")).toHaveCSS("opacity", "1"); // the Reveal wrapper
});
