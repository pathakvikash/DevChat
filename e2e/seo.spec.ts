import { test, expect } from "./fixtures";
import { AUTH_FILE } from "./helpers";

// A signed-out visitor, like a crawler.
test.use({ storageState: { cookies: [], origins: [] } });

test("the landing page is public, with one h1, a sign-in link and JSON-LD", async ({ page }) => {
  const res = await page.goto("/");
  expect(res!.status()).toBe(200);
  expect(res!.request().redirectedFrom()).toBeNull(); // rewritten to /welcome, not redirected
  await expect(page).toHaveURL(/\/$/);
  // The landing is in the first HTML, not streamed in behind the app skeleton.
  const html = await res!.text();
  expect(html).toMatch(/<h1[^>]*>One AI chat workspace/);
  expect(html).not.toContain('<template id="B:0"');
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Sign in to Orrery" })).toHaveAttribute("href", "/login");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(ld["@type"]).toBe("SoftwareApplication");
});

test("a feature page is public, with one h1, a canonical link and FAQ JSON-LD", async ({ page }) => {
  await page.goto("/features/agents");
  await expect(page).toHaveURL(/\/features\/agents$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/features\/agents$/);
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(ld["@graph"].map((n: { "@type": string }) => n["@type"])).toEqual(["BreadcrumbList", "FAQPage"]);
  await expect(page.getByRole("link", { name: "Sign in to Orrery" }).first()).toHaveAttribute("href", "/login");
});

test("marketing pages arrive as static HTML with no skeleton", async ({ request }) => {
  const html = await (await request.get("/features/agents")).text();
  expect(html).toContain("<h1");
  expect(html).not.toContain('<template id="B:0"');
});

test("an unknown marketing slug is a 404", async ({ request }) => {
  expect((await request.get("/features/nope", { maxRedirects: 0 })).status()).toBe(404);
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

// The signed-in "/" is the app home, not the landing page.
test.describe("signed in", () => {
  test.use({ storageState: AUTH_FILE });
  test("/ shows the app home", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Sign in to Orrery" })).toHaveCount(0);
    await expect(page.getByLabel("Message")).toBeVisible();
  });
});
