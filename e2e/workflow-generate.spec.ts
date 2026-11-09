import { test, expect, type APIRequestContext, type Page } from "./fixtures";
import { deleteAllChats } from "./helpers";

// "Describe your flow" (workflows 7): describe → preview → Apply or Discard. mock/flowgen always proposes the 4-card News flow.
type Graph = { nodes: Array<{ id: string; ui: { label: string } }> };

async function reset(request: APIRequestContext) {
  for (const w of (await (await request.get("/api/workflows")).json()) as Array<{ id: string }>) await request.delete(`/api/workflows/${w.id}`);
  await deleteAllChats(request);
}

async function create(request: APIRequestContext, template: "news" | "blank"): Promise<string> {
  const res = await request.post("/api/workflows", { data: { template, model: "mock/flowgen" } });
  expect(res.status()).toBe(201);
  return (await res.json()).id;
}

const saved = async (request: APIRequestContext, id: string): Promise<Graph> => (await (await request.get(`/api/workflows/${id}`)).json()).graph;
const ids = async (request: APIRequestContext, id: string) => (await saved(request, id)).nodes.map((n) => n.id);

const box = (page: Page) => page.getByRole("textbox", { name: "Describe your flow" });
/** The saved graph, whole, as text: Discard must leave every byte of it. */
const savedJson = async (request: APIRequestContext, id: string) => JSON.stringify(await saved(request, id));
/** Every PATCH to this workflow from the page, from now on. */
function watchPatches(page: Page, id: string): string[] {
  const seen: string[] = [];
  page.on("request", (r) => r.method() === "PATCH" && r.url().includes(`/api/workflows/${id}`) && seen.push(r.url()));
  return seen;
}
const alert = (page: Page) => page.getByRole("region", { name: "Describe your flow" }).locator("div:has(> button:has-text(\"Retry\"))"); // the error row
const preview = (page: Page, label: string) => page.getByRole("region", { name: "Proposed flow" }).getByText(label);

async function open(page: Page, id: string, view: "canvas" | "list" = "canvas") {
  await page.addInitScript((v) => localStorage.setItem("vas:workflowView", v), view);
  await page.goto(`/workflows/${id}`);
  await expect(page.getByRole("button", { name: "Runs" })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

/** mock/flowgen's flow has no problems, so add the warning the engine gives for an empty variable. */
async function withWarning(page: Page) {
  await page.route("**/api/workflows/generate", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), warnings: ["Fill in: Topics to search, one per line"] } });
  });
}

async function describe(page: Page, text: string) {
  await box(page).fill(text);
  await box(page).press("Enter");
}

test.describe("Describe your flow", () => {
  test.beforeEach(async ({ request }) => reset(request));

  test("a blank workflow offers the box; describe, preview, Apply saves the cards", async ({ page, request }) => {
    const id = await create(request, "blank");
    await open(page, id);
    await expect(box(page)).toBeVisible(); // expanded on an empty workflow
    await withWarning(page);
    const patches = watchPatches(page, id);
    await describe(page, "every morning, a digest of AI news");

    await expect(preview(page, "Preview · 4 cards")).toBeVisible();
    await expect(page.getByRole("group", { name: /^Write the digest, / })).toBeVisible(); // shown on the canvas
    await expect(page.getByRole("region", { name: "Proposed flow" }).getByText("Fill in: Topics to search, one per line")).toBeVisible(); // warnings are listed
    // Nothing is saved before Apply: wait past the 800 ms autosave, and see that no save was even sent.
    await page.waitForTimeout(1300);
    expect(patches, "a save was sent during the preview").toEqual([]);
    expect(await ids(request, id)).toEqual(["trigger"]);
    await expect(page.getByRole("button", { name: "Apply" })).toBeFocused();
    await page.getByRole("button", { name: "Apply" }).click(); // no confirm: the canvas had no cards
    await expect(page.getByRole("region", { name: "Proposed flow" })).toHaveCount(0);
    await expect.poll(() => ids(request, id)).toEqual(["trigger", "news", "digest", "post"]);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const g = await saved(request, id);
    expect(g.nodes.find((n) => n.id === "digest")?.ui.label).toBe("Write the digest");
  });

  test("works in the List view, and Discard keeps the old flow", async ({ page, request }) => {
    const id = await create(request, "news");
    // The mock proposes the same ids and labels as the template, so mark the saved flow: Apply would overwrite this.
    const graph = await saved(request, id);
    (graph.nodes.find((n) => n.id === "digest") as unknown as { config: Record<string, unknown> }).config.instructions = "KEEP ME ORIGINAL";
    expect((await request.patch(`/api/workflows/${id}`, { data: { graph } })).ok()).toBe(true);
    const before = await savedJson(request, id);
    expect(before).toContain("KEEP ME ORIGINAL");
    await open(page, id, "list");
    const patches = watchPatches(page, id);
    await expect(box(page)).toHaveCount(0); // collapsed while the flow has cards
    await page.getByRole("button", { name: "Describe your flow" }).click();
    await expect(box(page)).toBeFocused();
    await describe(page, "make it shorter");
    await expect(preview(page, "Preview · 4 cards")).toBeVisible();

    // Replacing asks first; saying no keeps the preview.
    let asked = "";
    page.once("dialog", (d) => {
      asked = d.message();
      void d.dismiss();
    });
    await page.getByRole("button", { name: "Apply" }).click();
    expect(asked).toBe("Replace the current flow?");
    await expect(preview(page, "Preview · 4 cards")).toBeVisible();
    // In the List view the proposed cards are plain: no "Open settings" buttons.
    await expect(page.getByRole("button", { name: /^Open settings for / })).toHaveCount(0);
    // Run is held back while a preview shows.
    await expect(page.getByRole("button", { name: "Run", exact: true })).toHaveAttribute("aria-disabled", "true");

    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByRole("region", { name: "Proposed flow" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Write the digest, Agent, Not run" })).toBeVisible();
    await page.waitForTimeout(1300); // past the 800 ms autosave
    expect(patches, "a save was sent").toEqual([]);
    expect(await savedJson(request, id)).toBe(before);
  });

  test('"broken" recovers through the repair call', async ({ page, request }) => {
    const id = await create(request, "blank");
    await open(page, id);
    await describe(page, "a broken first answer, please");
    await expect(preview(page, "Preview · 4 cards")).toBeVisible();
  });

  test("an error shows its message with a retry", async ({ page, request }) => {
    const id = await create(request, "blank");
    await open(page, id);
    const errors = [
      [409, "A flow is already being generated. Wait for it to finish."],
      [422, "Couldn't build a flow from that. Rephrase it or pick a stronger model."],
      [504, "The model took too long. Try again or pick a faster model."],
    ] as const;
    let n = 0;
    await page.route("**/api/workflows/generate", (route) => {
      const e = errors[n++];
      return e ? route.fulfill({ status: e[0], json: { error: e[1] } }) : route.continue();
    });
    await describe(page, "anything");
    for (const [i, [, message]] of errors.entries()) {
      await expect(alert(page)).toContainText(message);
      await expect(alert(page)).toContainText("Failed.");
      await expect(page.getByRole("button", { name: "Retry" })).toBeFocused();
      await page.getByRole("button", { name: "Retry" }).click();
      if (i < errors.length - 1) await expect(alert(page)).not.toContainText(message);
    }
    await expect(preview(page, "Preview · 4 cards")).toBeVisible(); // the fourth try reaches the server
    expect(await ids(request, id)).toEqual(["trigger"]);
  });

  test("Cancel aborts the request", async ({ page, request }) => {
    const id = await create(request, "blank");
    await open(page, id);
    await page.route("**/api/workflows/generate", () => {}); // never answered
    const failed = page.waitForEvent("requestfailed", (r) => r.url().includes("/api/workflows/generate"));
    await describe(page, "slow one");
    await expect(page.getByRole("region", { name: "Describe your flow" }).getByText("Building your flow")).toBeVisible();
    // Nothing is edited under the request: Run waits, the box stays open.
    await expect(page.getByRole("button", { name: "Run", exact: true })).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("button", { name: "Cancel" }).click();
    await failed; // the browser dropped the request
    await expect(page.getByRole("button", { name: "Build flow" })).toBeVisible();
    await expect(alert(page)).toHaveCount(0);
    expect(await box(page).inputValue()).toBe("slow one"); // the text stays
  });

  test("Esc cancels a slow build, from the text or from the Cancel button", async ({ page, request }) => {
    const id = await create(request, "blank");
    await open(page, id);
    await page.route("**/api/workflows/generate", () => {});
    for (const from of ["text", "button"] as const) {
      const failed = page.waitForEvent("requestfailed", (r) => r.url().includes("/api/workflows/generate"));
      await describe(page, "slow one");
      await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
      if (from === "button") await page.getByRole("button", { name: "Cancel" }).focus();
      await page.keyboard.press("Escape");
      await failed;
      await expect(page.getByRole("button", { name: "Build flow" })).toBeVisible();
      expect(await box(page).inputValue()).toBe("slow one");
    }
  });

  test("Cmd/Ctrl+Enter in the box neither builds nor runs", async ({ page, request }) => {
    const id = await create(request, "blank");
    await open(page, id);
    const sent: string[] = [];
    page.on("request", (r) => r.method() === "POST" && /\/api\/workflows\/(generate|[^/]+\/runs)/.test(r.url()) && sent.push(r.url()));
    await box(page).fill("not yet");
    await box(page).press("ControlOrMeta+Enter");
    await page.waitForTimeout(800);
    expect(sent).toEqual([]);
    await expect(page.getByRole("region", { name: "Proposed flow" })).toHaveCount(0);
    expect(await box(page).inputValue()).toBe("not yet");
  });
});

for (const theme of ["dark", "light"] as const) {
  test(`describe box and preview, ${theme}`, async ({ page, request }) => {
    await reset(request);
    await page.addInitScript((t) => localStorage.setItem("vas:theme", t), theme);
    const id = await create(request, "blank");
    await open(page, id);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(2, 2);
    await expect(page).toHaveScreenshot(`describe-empty-${theme}.png`);
    await withWarning(page);
    await describe(page, "every morning, a digest of AI news");
    await expect(preview(page, "Preview · 4 cards")).toBeVisible();
    await expect(page.getByRole("group", { name: /^Post to a chat, / })).toBeVisible();
    await page.waitForTimeout(500); // fit-view settles
    await page.mouse.move(2, 2);
    await expect(page).toHaveScreenshot(`describe-preview-${theme}.png`);
  });
}
