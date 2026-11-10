import { test, expect, type APIRequestContext } from "./fixtures";

async function createNews(request: APIRequestContext): Promise<string> {
  const res = await request.post("/api/workflows", { data: { template: "news", model: "mock/workflow" } });
  expect(res.status()).toBe(201);
  return (await res.json()).id;
}

const mcpCard = (cardId: string, label: string, from: string[], x: number, args: Record<string, string>) => ({
  id: cardId,
  type: "mcpTool",
  fromIds: from,
  config: { serverId: "s1", tool: "t", args },
  ui: { label, position: { x, y: 300 } },
});

test.beforeEach(async ({ request }) => {
  const list: Array<{ id: string }> = await (await request.get("/api/workflows")).json();
  for (const w of list) await request.delete(`/api/workflows/${w.id}`);
});

test("each MCP card shows its own arguments, and the web warning follows an upstream web card", async ({ page, request }) => {
  const id = await createNews(request);
  const { graph } = await (await request.get(`/api/workflows/${id}`)).json();
  graph.nodes.push(mcpCard("push_a", "Push A", ["news"], 900, { alpha: "1" }), mcpCard("push_b", "Push B", ["trigger"], 1300, { beta: "2" }));
  expect((await request.patch(`/api/workflows/${id}`, { data: { graph } })).ok()).toBe(true);

  await page.goto(`/workflows/${id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Open settings for Push A" }).click();
  await expect(page.getByLabel("Argument name")).toHaveValue("alpha");
  await expect(page.getByText("A page could try to steer it").first()).toBeVisible(); // the News search card is upstream
  await page.getByRole("button", { name: "Open settings for Push B" }).click();
  await expect(page.getByLabel("Argument name")).toHaveCount(1);
  await expect(page.getByLabel("Argument name")).toHaveValue("beta");
  await expect(page.getByText("A page could try to steer it")).toHaveCount(0);

  const saved = (await (await request.get(`/api/workflows/${id}`)).json()).graph.nodes;
  expect(saved.find((n: { id: string }) => n.id === "push_a").config.args).toEqual({ alpha: "1" });
  expect(saved.find((n: { id: string }) => n.id === "push_b").config.args).toEqual({ beta: "2" });
});

test("two arguments with the same name are not saved", async ({ page, request }) => {
  const id = await createNews(request);
  const { graph } = await (await request.get(`/api/workflows/${id}`)).json();
  graph.nodes.push(mcpCard("push", "Push", ["trigger"], 900, { a: "1" }));
  expect((await request.patch(`/api/workflows/${id}`, { data: { graph } })).ok()).toBe(true);
  await page.goto(`/workflows/${id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Open settings for Push" }).click();
  await page.getByRole("button", { name: "Add argument" }).click();
  await page.getByLabel("Argument name").nth(1).fill("a");
  await page.getByLabel("Argument value").nth(1).fill("2");
  await expect(page.getByRole("alert").filter({ hasText: 'Two arguments are called "a"' })).toBeVisible();
  await page.waitForTimeout(1500);
  const saved = (await (await request.get(`/api/workflows/${id}`)).json()).graph.nodes.find((n: { id: string }) => n.id === "push");
  expect(saved.config.args).toEqual({ a: "1" });
});
