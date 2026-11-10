import { test, expect, type APIRequestContext, type Page } from "./fixtures";
import { deleteAllChats } from "./helpers";

type Graph = { nodes: Array<{ id: string; type?: string; fromIds: string[]; config: Record<string, unknown>; ui: { label: string; position: { x: number; y: number } } }> };

async function reset(request: APIRequestContext) {
  for (const w of (await (await request.get("/api/workflows")).json()) as Array<{ id: string }>) await request.delete(`/api/workflows/${w.id}`);
  // The News template saves into the "News" table: a fresh one, so a run's articles are new.
  for (const t of (await (await request.get("/api/tables")).json()) as Array<{ id: string }>) await request.delete(`/api/tables/${t.id}`);
  await deleteAllChats(request);
}

async function create(request: APIRequestContext, template: "news" | "blank", model = "mock/workflow"): Promise<string> {
  const res = await request.post("/api/workflows", { data: { template, model } });
  expect(res.status()).toBe(201);
  return (await res.json()).id;
}

const saved = async (request: APIRequestContext, id: string): Promise<Graph> => (await (await request.get(`/api/workflows/${id}`)).json()).graph;

async function runToEnd(request: APIRequestContext, id: string): Promise<string> {
  const { runId } = await (await request.post(`/api/workflows/${id}/runs`)).json();
  await expect.poll(async () => (await (await request.get(`/api/workflow-runs/${runId}`)).json()).state, { timeout: 30_000 }).toBe("succeeded");
  return runId;
}

/** The toast, not the screen-reader live region that repeats it. */
const toast = (page: Page, text: string) => page.locator("span").filter({ hasText: text }).last();
const card = (page: Page, label: string, type: string, status: string) => page.getByRole("group", { name: `${label}, ${type}, ${status}` });
const handle = (page: Page, id: string, side: "left" | "right") => page.locator(`.react-flow__node[data-id="${id}"] .react-flow__handle-${side}`);

async function openCanvas(page: Page, id: string, query = "") {
  await page.goto(`/workflows/${id}${query}`);
  await expect(page.getByRole("region", { name: "Workflow canvas" })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

async function drag(page: Page, from: ReturnType<typeof handle>, to: ReturnType<typeof handle>) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

/** trigger → a, with b on its own below a. */
async function twoCards(request: APIRequestContext): Promise<string> {
  const id = await create(request, "blank");
  const graph = await saved(request, id);
  const agent = (cardId: string, fromIds: string[], x: number, y: number) => ({ id: cardId, type: "agent", fromIds, config: { instructions: "do it" }, ui: { label: cardId.toUpperCase(), position: { x, y } } });
  graph.nodes.push(agent("a", ["trigger"], 300, 0), agent("b", [], 300, 200));
  expect((await request.patch(`/api/workflows/${id}`, { data: { graph } })).ok()).toBe(true);
  return id;
}

/** trigger → reader (reads chats), and web (reaches the web) on its own: connecting reader → web is refused. */
async function leakCards(request: APIRequestContext): Promise<string> {
  const id = await create(request, "blank");
  const graph = await saved(request, id);
  graph.nodes.push(
    { id: "reader", type: "agent", fromIds: ["trigger"], config: { instructions: "read", tools: ["readChat"] }, ui: { label: "Reader", position: { x: 340, y: 0 } } },
    { id: "web", type: "webSearch", fromIds: ["trigger"], config: { queries: "x" }, ui: { label: "Web", position: { x: 340, y: 200 } } },
  );
  expect((await request.patch(`/api/workflows/${id}`, { data: { graph } })).ok()).toBe(true);
  return id;
}

test.beforeEach(async ({ request }) => reset(request));

test("adding a card keeps the save rules: a refused connection leaves the new card unconnected", async ({ page, request }) => {
  const id = await leakCards(request);
  await openCanvas(page, id);
  await card(page, "Reader", "Agent", "Not run").click();
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByRole("dialog", { name: "Add card" }).getByRole("button", { name: /Web search/ }).click();
  await expect(toast(page, "a later card reaches the web")).toBeVisible();
  await expect(card(page, "Web search", "Web search", "Not run")).toBeVisible();
  await expect.poll(async () => (await saved(request, id)).nodes.find((n) => n.id === "web_search")?.fromIds).toEqual([]);
});

test("Runs after refuses a connection that breaks a save rule", async ({ page, request }) => {
  const id = await leakCards(request);
  await openCanvas(page, id);
  await card(page, "Web", "Web search", "Not run").click();
  await page.getByRole("button", { name: "Advanced" }).click();
  const box = page.getByRole("checkbox", { name: "Reader" });
  await box.click();
  await expect(toast(page, "a later card reaches the web")).toBeVisible();
  await expect(box).not.toBeChecked();
  expect((await saved(request, id)).nodes.find((n) => n.id === "web")!.fromIds).toEqual(["trigger"]);
  await page.getByRole("checkbox", { name: "Run manually" }).click(); // unticking is always allowed
  await expect.poll(async () => (await saved(request, id)).nodes.find((n) => n.id === "web")!.fromIds).toEqual([]);
});

test("clicking a connector and pressing Delete removes it", async ({ page, request }) => {
  const id = await twoCards(request);
  await openCanvas(page, id);
  await page.locator('.react-flow__edge[data-id="trigger->a"] .react-flow__edge-interaction').click();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await saved(request, id)).nodes.find((n) => n.id === "a")!.fromIds).toEqual([]);
});

test("the Add card button toggles its menu, and Esc returns the focus to it", async ({ page, request }) => {
  const id = await create(request, "blank");
  await openCanvas(page, id);
  const button = page.getByRole("button", { name: "Add card" });
  await button.click();
  await expect(page.getByRole("dialog", { name: "Add card" })).toBeVisible();
  await button.click();
  await expect(page.getByRole("dialog", { name: "Add card" })).toHaveCount(0);
  await button.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add card" })).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("closing the Add card menu by clicking into a field keeps the focus there", async ({ page, request }) => {
  const id = await create(request, "news");
  await openCanvas(page, id);
  await card(page, "Write the digest", "Agent", "Not run").click();
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByRole("dialog", { name: "Add card" })).toBeVisible();
  const instructions = page.getByLabel("Instructions");
  await instructions.click();
  await expect(page.getByRole("dialog", { name: "Add card" })).toHaveCount(0);
  await page.keyboard.type("typed here");
  await expect(instructions).toHaveValue(/typed here$/);
  await expect(page.getByRole("button", { name: "Add card" })).not.toBeFocused();
});

test("picking a card type in the menu focuses the new card", async ({ page, request }) => {
  const id = await create(request, "blank");
  await openCanvas(page, id);
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByRole("dialog", { name: "Add card" }).getByRole("button", { name: /Agent/ }).click();
  await expect(card(page, "Agent", "Agent", "Not run")).toBeFocused();
});

test("at 900px dragging a card does not open its settings", async ({ page, request }) => {
  const id = await twoCards(request);
  await page.setViewportSize({ width: 900, height: 800 });
  await openCanvas(page, id);
  const box = (await card(page, "B", "Agent", "Not run").boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 80, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await saved(request, id)).nodes.find((n) => n.id === "b")!.ui.position.y).toBeGreaterThan(200);
  await expect(page.getByRole("complementary", { name: "B settings" })).toHaveCount(0);
});

test("+ adds a card after the selected one, and settings save", async ({ page, request }) => {
  const id = await create(request, "blank");
  await openCanvas(page, id);
  await card(page, "Run manually", "Run manually", "Not run").click();
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByRole("dialog", { name: "Add card" })).toBeVisible();
  await page.getByLabel("Filter cards").fill("agen");
  await page.getByRole("dialog", { name: "Add card" }).getByRole("button", { name: /Agent/ }).click();

  await expect(card(page, "Agent", "Agent", "Not run")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Agent settings" })).toBeVisible();
  await page.getByLabel("Instructions").fill("Summarise.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const graph = await saved(request, id);
  const agent = graph.nodes.find((n) => n.id === "agent")!;
  expect(agent.fromIds).toEqual(["trigger"]);
  expect(agent.config.instructions).toBe("Summarise.");
  expect(agent.ui.position.x).toBeGreaterThan(graph.nodes[0].ui.position.x);
});

test("dragging from an output to an input connects, and a loop is refused with its message", async ({ page, request }) => {
  const id = await twoCards(request);
  await openCanvas(page, id);

  await drag(page, handle(page, "a", "right"), handle(page, "b", "left"));
  await expect.poll(async () => (await saved(request, id)).nodes.find((n) => n.id === "b")!.fromIds).toEqual(["a"]);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await drag(page, handle(page, "b", "right"), handle(page, "a", "left"));
  await expect(toast(page, "Cards can't loop back")).toBeVisible();
  expect((await saved(request, id)).nodes.find((n) => n.id === "a")!.fromIds).toEqual(["trigger"]);
});

test("dropping a connector on empty canvas opens the catalog and connects the new card", async ({ page, request }) => {
  const id = await twoCards(request);
  await openCanvas(page, id);
  const from = (await handle(page, "a", "right").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 150, from.y + 250, { steps: 10 });
  await page.mouse.up();

  await page.getByRole("dialog", { name: "Add card" }).getByRole("button", { name: /Send to chat/ }).click();
  await expect(card(page, "Send to chat", "Send to chat", "Not run")).toBeVisible();
  await expect.poll(async () => (await saved(request, id)).nodes.find((n) => n.id === "send_to_chat")?.fromIds).toEqual(["a"]);
});

test("Delete removes a card after a confirm, and the first card can't be deleted", async ({ page, request }) => {
  const id = await twoCards(request);
  await openCanvas(page, id);

  await card(page, "Run manually", "Run manually", "Not run").click();
  await page.keyboard.press("Delete");
  await expect(toast(page, "The first card starts the flow, so it can't be deleted")).toBeVisible();
  await expect(card(page, "Run manually", "Run manually", "Not run")).toBeVisible();

  page.once("dialog", (d) => {
    expect(d.message()).toBe("Delete “B”?");
    void d.dismiss();
  });
  await card(page, "B", "Agent", "Not run").focus();
  await page.keyboard.press("Delete");
  await expect(card(page, "B", "Agent", "Not run")).toBeVisible();

  page.once("dialog", (d) => void d.accept());
  await page.keyboard.press("Delete");
  await expect(card(page, "B", "Agent", "Not run")).toHaveCount(0);
  await expect(page.locator(".react-flow__node:focus")).toHaveCount(1); // the focus went to a card, not the page
  await expect.poll(async () => (await saved(request, id)).nodes.map((n) => n.id)).toEqual(["trigger", "a"]);
});

test("typing {{ opens the field picker and inserts the reference", async ({ page, request }) => {
  const id = await create(request, "news");
  await openCanvas(page, id);
  await card(page, "Write the digest", "Agent", "Not run").click();
  const input = page.getByLabel("Input", { exact: true });
  await input.fill("");
  await input.pressSequentially("{{");
  await expect(page.getByRole("dialog", { name: "Insert field" })).toBeVisible();
  await page.getByRole("option", { name: /news\.items/ }).click();
  await expect(input).toHaveValue("{{news.items}}");

  await input.pressSequentially(" and {{");
  await page.getByLabel("Filter fields").press("Escape");
  await expect(page.getByRole("dialog", { name: "Insert field" })).toHaveCount(0);
  await expect(input).toHaveValue("{{news.items}} and {{");

  // An outside click closes the picker; Insert field after that adds at the caret and removes nothing.
  await input.fill("");
  await input.pressSequentially("ab{{");
  await expect(page.getByRole("dialog", { name: "Insert field" })).toBeVisible();
  await page.getByLabel("Card name").click();
  await expect(page.getByRole("dialog", { name: "Insert field" })).toHaveCount(0);
  await page.getByRole("button", { name: "Insert field" }).nth(1).click();
  await page.getByRole("option", { name: /news\.count/ }).click();
  await expect(input).toHaveValue("ab{{{{news.count}}");
});

test("a run shows each card's status on the canvas, the Runs drawer lists it, and ?run= is read-only", async ({ page, request }) => {
  const id = await create(request, "news");
  await openCanvas(page, id);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  for (const [label, type] of [["Run manually", "Run manually"], ["Search the news", "Web search"], ["Write the digest", "Agent"], ["Post to a chat", "Send to chat"]]) {
    await expect(card(page, label, type, "Done")).toBeVisible({ timeout: 30_000 });
  }

  await page.getByRole("button", { name: "Runs", exact: true }).click();
  await expect(page.getByText("Newest first. The last 50 are kept.")).toBeVisible();
  await page.getByRole("button", { name: /^Done.*Manual/ }).first().click();
  await expect(page).toHaveURL(/\?run=/);
  await expect(page.getByText(/^Run · /)).toBeVisible();
  await expect(card(page, "Write the digest", "Agent", "Done")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add card" })).toHaveCount(0);
  await expect(page.locator(".react-flow__node.draggable")).toHaveCount(0);
  await page.getByRole("button", { name: "Open settings for Write the digest" }).click();
  await expect(page.getByText("This is a past run, so its cards are read-only.")).toBeVisible();
  await expect(page.getByLabel("Instructions")).toBeDisabled();
});

test("keyboard: Tab moves between cards, Enter opens settings, Esc closes them", async ({ page, request }) => {
  const id = await create(request, "news");
  await openCanvas(page, id);
  const first = card(page, "Run manually", "Run manually", "Not run");
  const second = card(page, "Search the news", "Web search", "Not run");
  await first.focus();
  await page.keyboard.press("Tab");
  await expect(second).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary", { name: "Search the news settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "Search the news settings" })).toHaveCount(0);
  await page.keyboard.press("Shift+Tab");
  await expect(first).toBeFocused();
});

test("moving a card saves its position, and Tidy up arranges the cards in columns", async ({ page, request }) => {
  const id = await twoCards(request);
  await openCanvas(page, id);
  const node = card(page, "B", "Agent", "Not run");
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 112, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await saved(request, id)).nodes.find((n) => n.id === "b")!.ui.position.y).toBeGreaterThan(200);

  await page.getByRole("button", { name: "Tidy up" }).click();
  // b has no input, so it joins the first column with the trigger; a is one column on (340px).
  await expect.poll(async () => (await saved(request, id)).nodes.map((n) => n.ui.position)).toEqual([
    { x: 0, y: -80 },
    { x: 340, y: 0 },
    { x: 0, y: 80 },
  ]);
});

test("the Canvas | List toggle switches the view and remembers it", async ({ page, request }) => {
  const id = await create(request, "news");
  await openCanvas(page, id);
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByRole("list", { name: "Cards in run order" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Workflow canvas" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("list", { name: "Cards in run order" })).toBeVisible();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(page.getByRole("region", { name: "Workflow canvas" })).toBeVisible();
});

test("at 400px the list view shows instead of the canvas", async ({ page, request }) => {
  const id = await create(request, "news");
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto(`/workflows/${id}`);
  await expect(page.getByRole("list", { name: "Cards in run order" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Workflow canvas" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "View" })).toHaveCount(0);
});

// Visual baselines: the canvas at 1280px in both themes, idle and with a finished run.
for (const theme of ["dark", "light"] as const) {
  for (const finished of [false, true]) {
    test(`canvas with the News template ${finished ? "after a run" : "idle"}, ${theme}`, async ({ page, request }) => {
      await page.addInitScript((t) => localStorage.setItem("vas:theme", t), theme);
      const id = await create(request, "news");
      if (finished) await runToEnd(request, id);
      await openCanvas(page, id);
      await expect(card(page, "Post to a chat", "Send to chat", finished ? "Done" : "Not run")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(2, 2);
      await page.waitForTimeout(400); // fitView has settled
      await expect(page).toHaveScreenshot(`workflow-canvas-${finished ? "run" : "idle"}-${theme}.png`);
    });
  }
}
