import { test, expect, type Page } from "./fixtures";

const html = (page: Page) => page.locator("html");

async function openProfile(page: Page) {
  await page.getByRole("button", { name: "Sanity Test User" }).click();
  await expect(page.getByRole("heading", { name: "Theme" })).toBeVisible();
}

test("the theme toggle switches light and dark, repaints the page, and is remembered", async ({ page }) => {
  await page.goto("/settings");
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  const darkBackground = await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor);

  await openProfile(page);
  await page.getByRole("button", { name: "Light" }).click();
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("vas:theme"))).toBe("light");
  await expect
    .poll(() => page.locator("main").evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor))
    .not.toBe(darkBackground);

  await page.reload();
  await expect(html(page)).toHaveAttribute("data-theme", "light");

  await openProfile(page);
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("vas:theme"))).toBe("dark");
});
