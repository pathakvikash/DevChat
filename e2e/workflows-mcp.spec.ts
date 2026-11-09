import { test, expect, type APIRequestContext } from "./fixtures";

async function createNews(request: APIRequestContext): Promise<string> {
  const res = await request.post("/api/workflows", { data: { template: "news", model: "mock/workflow" } });
  expect(res.status()).toBe(201);
  return (await res.json()).id;
}

const mcpCard = (from: string) => ({
  id: "push",
  type: "mcpTool",
  fromIds: [from],
  config: { serverId: "no-such-server", tool: "create_issue", args: { title: "{{digest.text}}" } },
  ui: { label: "Push", position: { x: 900, y: 0 } },
});

test.beforeEach(async ({ request }) => {
  const list: Array<{ id: string }> = await (await request.get("/api/workflows")).json();
  for (const w of list) await request.delete(`/api/workflows/${w.id}`);
});

test("MCP tools and a web tool on one card are refused at save, and the editor disables the clash", async ({ page, request }) => {
  const id = await createNews(request);
  const { graph } = await (await request.get(`/api/workflows/${id}`)).json();
  const digest = graph.nodes.find((n: { id: string }) => n.id === "digest");
  digest.config.tools = ["fetchUrl"];
  digest.config.mcpTools = ["mcp_gh_create_issue"];
  const refused = await request.patch(`/api/workflows/${id}`, { data: { graph } });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toContain("reads private data (chats, MCP or a folder)");

  // MCP alone saves; the web tools are then disabled and the page says why
  digest.config.tools = [];
  expect((await request.patch(`/api/workflows/${id}`, { data: { graph } })).ok()).toBe(true);
  await page.goto(`/workflows/${id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Open settings for Write the digest" }).click();
  await expect(page.getByRole("checkbox", { name: "Fetch URL" })).toBeDisabled();
  await expect(page.getByText("Web tools are off while this card has MCP tools")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Web search" })).toBeDisabled();
  // the News search card is upstream of the digest, so the steering warning shows too
  await expect(page.getByText("A page could try to steer it")).toBeVisible();
  await expect(page.getByText("Warning:").first()).toBeVisible();
  await expect(page.getByText("Can change things outside DevChat").first()).toBeVisible();
  // the mock model is not a command-line model, so there is no folder to pick
  await expect(page.getByText("Working folder", { exact: true })).toHaveCount(0);
});

test("the MCP-after-MCP warning shows on the later card", async ({ page, request }) => {
  const id = await createNews(request);
  const { graph } = await (await request.get(`/api/workflows/${id}`)).json();
  const card = (cid: string, from: string[], x: number) => ({ id: cid, type: "mcpTool", fromIds: from, config: { serverId: "s1", tool: "t" }, ui: { label: cid === "m1" ? "First" : "Second", position: { x, y: 300 } } });
  graph.nodes.push(card("m1", ["trigger"], 900), card("m2", ["m1"], 1300));
  expect((await request.patch(`/api/workflows/${id}`, { data: { graph } })).ok()).toBe(true);
  await page.goto(`/workflows/${id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Open settings for Second" }).click();
  await expect(page.getByText("an earlier card read data through MCP")).toBeVisible();
  await page.getByRole("button", { name: "Open settings for First" }).click();
  await expect(page.getByText("an earlier card read data through MCP")).toHaveCount(0);
});

test("a chat-reading card before an MCP card is refused at save, and an MCP card with no live server is refused at Run", async ({ request }) => {
  const id = await createNews(request);
  const { graph } = await (await request.get(`/api/workflows/${id}`)).json();
  const digest = graph.nodes.find((n: { id: string }) => n.id === "digest");
  digest.config.tools = ["readChat"];
  graph.nodes.push(mcpCard("digest"));
  const refused = await request.patch(`/api/workflows/${id}`, { data: { graph } });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toContain("reads private data (chats, MCP or a folder) and a later card reaches the web");

  digest.config.tools = [];
  expect((await request.patch(`/api/workflows/${id}`, { data: { graph } })).ok()).toBe(true);
  const run = await request.post(`/api/workflows/${id}/runs`);
  expect(run.status()).toBe(400);
  expect((await run.json()).error).toContain("MCP server");
});
