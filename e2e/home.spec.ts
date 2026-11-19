import { test, expect } from "./fixtures";
import { composer } from "./helpers";

test("the prompt is in the first viewport; starting a chat leaves no Lenis behind", async ({
  page,
}) => {
  await page.goto("/");
  await expect(composer(page)).toBeInViewport();
  await expect(page.locator("html")).toHaveClass(/lenis/); // smooth scroll runs on the home page
  await composer(page).fill("hello tour");
  await page.keyboard.press("Enter");
  // The ?q= is dropped by the chat page once it loads, so only the route is stable.
  await expect(page).toHaveURL(/\/c\/[a-z0-9]+/);
  await expect(page.locator("html")).not.toHaveClass(/lenis/); // destroyed on navigation
});

test("a section reveals when scrolled into view", async ({ page }) => {
  await page.goto("/");
  const heading = page.getByRole("heading", { name: "More than a chat box." });
  await heading.scrollIntoViewIfNeeded();
  await expect(heading.locator("xpath=..")).toHaveCSS("opacity", "1"); // the Reveal wrapper
});

test("the sticky bar is out of the tab order until the hero is scrolled past", async ({ page }) => {
  await page.goto("/");
  // Right after load the DOM can briefly hold a second sticky bar; wait for hydration (Lenis mounts in an effect) first.
  await expect(page.locator("html")).toHaveClass(/lenis/);
  await expect(page.locator(".glass-nav")).toHaveCount(1);
  await expect(page.locator(".glass-nav")).toHaveJSProperty("inert", true);
  await composer(page).focus();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".glass-nav"))).toBe(false);
  }
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.5));
  await expect(page.getByRole("link", { name: "New chat" })).toBeVisible();
});

test("scrolling through the modes scene reaches step 3", async ({ page }) => {
  await page.goto("/");
  // The scene renders stacked until hydration, then pins; scroll only once Lenis and the pinned layout are live.
  await expect(page.locator("html")).toHaveClass(/lenis/);
  await expect(page.locator("section[aria-labelledby='modes-heading'] .sticky")).toBeAttached();
  await page.evaluate(() => {
    const top =
      document.querySelector("#modes-heading")!.closest("section")!.getBoundingClientRect().top +
      scrollY;
    window.scrollTo({ top: top + 0.95 * (2.4 * innerHeight - innerHeight), behavior: "instant" }); // near the end of the 240vh wrapper
  });
  const step = page.getByRole("heading", { name: /^Agent\. It uses tools/ });
  await expect(step.locator("xpath=ancestor::div[contains(@class,'absolute')][1]")).toHaveCSS(
    "opacity",
    "1",
  );
});
