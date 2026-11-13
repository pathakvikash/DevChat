import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { createChat, deleteAllChats, openChat, regenerateButtons, send } from "./helpers";

const FOLDER = path.join(__dirname, "fixtures/project");
const mode = (page: Page, name: "Agent") =>
  page.getByRole("radiogroup", { name: "Conversation mode" }).first().getByRole("radio", { name });

test("an HTML artifact runs with no parent access and no network, and its response says sandbox", async ({ page, request }) => {
  const id = await createChat(request, { title: "Sandbox probe chat", model: "mock/artifact" });
  await openChat(page, id);
  await mode(page, "Agent").click();
  await send(page, "make the page");
  await expect(regenerateButtons(page)).toHaveCount(1);

  // A created artifact opens the panel by itself.
  const frame = page.frameLocator('iframe[title="Sandbox probe"]');
  await expect(frame.getByText("parent: blocked")).toBeVisible();
  await expect(frame.getByText("fetch: blocked")).toBeVisible();
  await expect(page.locator('iframe[title="Sandbox probe"]')).toHaveAttribute("sandbox", "allow-scripts");

  // The header only wins over the global policy when the config entries are in the right order.
  const list = await (await request.get(`/api/conversations/${id}/artifacts`)).json();
  const res = await request.get(`/api/conversations/${id}/artifacts/${list.artifacts[0].id}/html`);
  expect(res.headers()["content-security-policy"]).toContain("sandbox allow-scripts");

  // "Open in new tab" goes to the wrapper page, which frames the artifact: it cannot navigate the top page away.
  await page.goto(`/artifact-preview/${id}/${list.artifacts[0].id}`);
  await expect(page.frameLocator("iframe").getByText("fetch: blocked")).toBeVisible();
});

test("an SVG artifact is shown as an image: its script and onerror never run in the app page", async ({ page, request }) => {
  const id = await createChat(request, { title: "Svg probe chat", model: "mock/svg" });
  await openChat(page, id);
  await mode(page, "Agent").click();
  await send(page, "draw it");
  await expect(regenerateButtons(page)).toHaveCount(1);

  const img = page.locator('img[alt="Svg probe"]');
  await expect(img).toBeVisible();
  expect(await img.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as unknown as { __svgRan?: boolean }).__svgRan)).toBeUndefined();
  expect(await page.title()).not.toBe("svg-ran");
});

test("in a folder chat an HTML page asks first: nothing is created before Allow, the preview shows after", async ({ page, request }) => {
  const id = await createChat(request, { title: "Html gate chat", model: "mock/artifact" });
  expect((await request.patch(`/api/conversations/${id}`, { data: { workingFolder: FOLDER } })).ok()).toBeTruthy();
  await openChat(page, id);
  await mode(page, "Agent").click();
  await send(page, "make the page");

  const card = page.getByRole("group", { name: /Needs your OK/ });
  await expect(card).toContainText("Create an HTML page");
  await expect(card).toContainText("Sends data out");
  await expect(card).toContainText("typeof parent.document");
  await expect(card.getByRole("button", { name: "Allow for this chat" })).toHaveCount(0);
  const before = await (await request.get(`/api/conversations/${id}/artifacts`)).json();
  expect(before.artifacts).toHaveLength(0);

  await card.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(regenerateButtons(page)).toHaveCount(1);
  await expect(page.frameLocator('iframe[title="Sandbox probe"]').getByText("fetch: blocked")).toBeVisible();
});

test.beforeEach(({ request }) => deleteAllChats(request));

async function seedFence(page: Page, request: APIRequestContext, lang: string, ...codes: string[]) {
  const id = await createChat(request, { title: "Run probe" });
  const content = "Try it.\n\n" + codes.map((c) => "```" + lang + "\n" + c + "\n```").join("\n\n");
  expect((await request.post(`/api/conversations/${id}/messages`, { data: { role: "assistant", content } })).ok()).toBeTruthy();
  await openChat(page, id);
}

const run = (page: Page) => page.getByRole("button", { name: "Run", exact: true });

test("Run on a JavaScript block prints its output, and its fetch is blocked", async ({ page, request }) => {
  // The host never resolves: a block by the frame's policy happens before any request is made.
  const attempts: string[] = [];
  page.on("request", (r) => r.url().includes("devchat-test.invalid") && attempts.push(r.url()));
  await seedFence(
    page,
    request,
    "javascript",
    [
      "let blocked = false;",
      "document.addEventListener('securitypolicyviolation', () => { blocked = true; });",
      "try { await fetch('https://devchat-test.invalid/x', { mode: 'no-cors' }); } catch {}",
      "await new Promise((r) => setTimeout(r, 100));",
      "console.log('ran: ' + 6 * 7);",
      "console.log(blocked ? 'fetch: blocked by policy' : 'fetch: allowed by policy');",
    ].join("\n"),
  );
  await run(page).click();
  // Match the whole output: the code block above it contains these words too.
  await expect(page.getByText(/^ran: 42\s+fetch: blocked by policy$/)).toBeVisible();
  expect(attempts).toEqual([]);
});

// The page's frame-src stops the frame going anywhere: the frame is replaced by a blocked page, so the Run
// times out, and no request is made.
test("the Run frame cannot leave for another site", async ({ page, request }) => {
  const requested: string[] = [];
  page.on("request", (r) => r.url().includes("devchat-test.invalid") && requested.push(r.url()));
  await seedFence(page, request, "javascript", "location.href = 'https://devchat-test.invalid/nav';\nawait new Promise(() => {});");
  await page.evaluate(() => {
    const w = window as unknown as { __blocked: string[] };
    w.__blocked = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__blocked.push(`${e.effectiveDirective} ${e.blockedURI}`));
  });
  await run(page).click();
  await expect(page.getByText(/execution timed out/)).toBeVisible({ timeout: 15_000 });
  expect(requested).toEqual([]);
  const blocked = await page.evaluate(() => (window as unknown as { __blocked: string[] }).__blocked);
  expect(blocked).toContainEqual(expect.stringMatching(/^frame-src https:\/\/devchat-test\.invalid/));
});

test("Python runs in a sandboxed frame, not in the app window", async ({ page, request }) => {
  await page.route("https://cdn.jsdelivr.net/**", (r) => r.abort());
  await seedFence(page, request, "python", "print(1)");
  await run(page).click();
  await expect(page.getByText(/^Error:/)).toBeVisible({ timeout: 30_000 });
  const frame = page.locator("iframe").first();
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  expect(await frame.getAttribute("srcdoc")).toMatch(
    /^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/,
  );
  expect(await page.evaluate(() => (window as unknown as { __pyodide?: unknown }).__pyodide)).toBeUndefined();
});

// Needs cdn.jsdelivr.net. Run with LIVE_PYODIDE=1.
test("Run on a Python block loads numpy, blocks fetch, and keeps state between Runs", async ({ page, request }) => {
  test.skip(!process.env.LIVE_PYODIDE, "set LIVE_PYODIDE=1 (needs cdn.jsdelivr.net)");
  test.setTimeout(240_000);
  const other = await createChat(request, { title: "Other python chat" });
  const content = "Check.\n\n```python\nprint('numpy' in dir())\n```";
  expect((await request.post(`/api/conversations/${other}/messages`, { data: { role: "assistant", content } })).ok()).toBeTruthy();
  await seedFence(
    page,
    request,
    "python",
    "import numpy\nprint('sum:', int(numpy.arange(4).sum()))\nimport asyncio\nfrom js import document, fetch\nfrom pyodide.ffi import create_proxy\nblocked = []\ndocument.addEventListener('securitypolicyviolation', create_proxy(lambda e: blocked.append(1)))\ntry:\n    await fetch('https://devchat-test.invalid/x')\nexcept Exception:\n    pass\nawait asyncio.sleep(0.1)\nprint('fetch: blocked by policy' if blocked else 'fetch: allowed by policy')",
    "print(numpy.__name__)",
  );
  await run(page).first().click();
  await expect(page.getByText(/^sum: 6\s+fetch: blocked by policy$/)).toBeVisible({ timeout: 120_000 });

  // A second Run in the same page sees the first one's variables.
  await run(page).nth(1).click();
  await expect(page.getByText("numpy", { exact: true })).toBeVisible({ timeout: 30_000 });

  // Another chat gets a fresh Python: numpy is not defined there.
  await page.getByRole("link", { name: /Other python chat/ }).first().click();
  await run(page).first().click();
  await expect(page.getByText(/^False$/)).toBeVisible({ timeout: 120_000 });
});
