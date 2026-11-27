import { test, expect } from "./fixtures";

// A signed-out visitor, like a crawler.
test.use({ storageState: { cookies: [], origins: [] } });

test("the landing page is public, with one h1, a sign-in link and JSON-LD", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Sign in to Orrery" })).toHaveAttribute("href", "/login");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(ld["@type"]).toBe("SoftwareApplication");
});

test("/login is noindex", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("robots.txt and sitemap.xml are public", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/Disallow: \/api\//);
  expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
  const map = await request.get("/sitemap.xml");
  expect(map.status()).toBe(200);
  expect(await map.text()).toContain("<loc>");
});

test("a private page is not indexable", async ({ request }) => {
  const res = await request.get("/settings", { maxRedirects: 0 });
  expect(res.headers()["x-robots-tag"]).toMatch(/noindex/);
});
