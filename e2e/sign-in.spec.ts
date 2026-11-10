import { test, expect } from "./fixtures";

// Every test here starts signed out.
test.use({ storageState: { cookies: [], origins: [] } });

test("signed-out visitors are sent to the login page", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fsettings/);
  await expect(page.getByRole("heading", { name: "Sign in to DevChat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
});

test("API calls without a session get 401", async ({ request }) => {
  const res = await request.get("/api/conversations");
  expect(res.status()).toBe(401);
});

test("the test-user button signs in and returns to the page you wanted", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign in as test user" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings & Analytics" })).toBeVisible();
});

test("signing out returns to the login page", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in as test user" }).click();
  await page.waitForURL("/");
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sanity Test User" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in to DevChat" })).toBeVisible();
});
