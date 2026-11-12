import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { createChat, openChat, regenerateButtons, send } from "./helpers";

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
