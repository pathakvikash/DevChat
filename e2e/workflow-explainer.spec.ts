import path from "node:path";
import { test, expect, type APIRequestContext, type Page } from "./fixtures";
import { deleteAllChats, openChat } from "./helpers";

// The "Explain a project or feature" sample flows. The GitHub API is answered from e2e/fixtures/workflows (sanity mode),
// and the mock model replies with a small explainer that has a mermaid flowchart.
type Graph = { defaultModel: string; vars: { key: string; value: string }[]; nodes: { id: string; config: Record<string, unknown> }[] };
const FOLDER = path.join(__dirname, "fixtures/project");

async function clearWorkflows(request: APIRequestContext) {
  for (const w of (await (await request.get("/api/workflows")).json()) as Array<{ id: string }>) await request.delete(`/api/workflows/${w.id}`);
}

/** Creates a workflow from the New workflow menu and returns its id. */
async function createFromMenu(page: Page, label: string): Promise<string> {
  await page.goto("/workflows");
  await page.getByRole("button", { name: "New workflow" }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${label}`) }).click();
  await page.waitForURL(/\/workflows\/[^/]+$/);
  return page.url().split("/").pop()!;
}

/** Saves the graph with the changes `edit` makes; the menu does not set a model, so the mock model goes in here. */
async function edit(request: APIRequestContext, id: string, change: (g: Graph) => void) {
  const graph = (await (await request.get(`/api/workflows/${id}`)).json()).graph;
  const g = typeof graph === "string" ? JSON.parse(graph) : graph;
  g.defaultModel = "mock/workflow";
  change(g);
  const res = await request.patch(`/api/workflows/${id}`, { data: { graph: g } });
  expect(res.ok(), await res.text()).toBe(true);
}

test.beforeEach(async ({ page, request }) => {
  await page.addInitScript(() => (localStorage.setItem("vas:theme", "dark"), localStorage.setItem("vas:workflowView", "list")));
  await clearWorkflows(request);
  await deleteAllChats(request);
});

test("the New workflow menu lists the two explainers after the others, the folder one marked Local", async ({ page }) => {
  await page.goto("/workflows");
  await page.getByRole("button", { name: "New workflow" }).click();
  const items = page.getByRole("menuitem");
  await expect(items).toHaveCount(5);
  await expect(items.nth(3)).toContainText("Explain a GitHub repo");
  await expect(items.nth(4)).toContainText("Explain a project folder");
  await expect(items.nth(4)).toContainText("Local");
  await expect(items.nth(4)).toBeEnabled();
  await page.mouse.move(2, 2);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("menu")).toHaveScreenshot("new-workflow-menu-dark.png");
});

test("Explain a GitHub repo runs on the stubbed GitHub API and posts a chat with a drawn diagram", async ({ page, request }) => {
  const id = await createFromMenu(page, "Explain a GitHub repo");
  await edit(request, id, (g) => {
    g.vars.find((v) => v.key === "repo")!.value = "https://github.com/acme/widgets/"; // a URL is read as owner/name
  });

  const started = await request.post(`/api/workflows/${id}/runs`);
  expect(started.status(), await started.text()).toBe(202);
  const { runId } = await started.json();
  await expect.poll(async () => (await (await request.get(`/api/workflow-runs/${runId}`)).json()).state, { timeout: 30_000 }).toBe("succeeded");

  const info = await (await request.get(`/api/workflow-runs/${runId}?node=info`)).json();
  expect(info.output.url).toBe("https://api.github.com/repos/acme/widgets");
  expect(info.output.data.full_name).toBe("acme/widgets");
  const tree = await (await request.get(`/api/workflow-runs/${runId}?node=tree`)).json();
  expect(tree.output.url).toBe("https://api.github.com/repos/acme/widgets/git/trees/HEAD");

  const post = await (await request.get(`/api/workflow-runs/${runId}?node=post`)).json();
  await openChat(page, post.output.conversationId);
  await expect(page.getByRole("img", { name: "Flowchart diagram" }).locator("svg")).toBeVisible();
  await expect(page.getByText("Mock explainer (deterministic)")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("explainer-reply-in-chat.png") });
});

test("Explain a project folder asks only for a folder; an API model shows the folder field but not Allow edits", async ({ page, request }) => {
  const id = await createFromMenu(page, "Explain a project folder");
  await edit(request, id, () => {});
  await page.goto(`/workflows/${id}`);
  await page.getByRole("button", { name: "Open settings for Explain it" }).click();
  const panel = page.getByRole("complementary", { name: "Explain it settings" });
  const allowEdits = panel.getByRole("checkbox", { name: "Allow edits in the folder" });

  await expect(panel.getByText("Pick the project folder")).toBeVisible();
  await expect(panel.getByText("Working folder", { exact: true })).toBeVisible();
  await expect(allowEdits).toHaveCount(0);

  // Run is refused until a folder is picked.
  const refused = await request.post(`/api/workflows/${id}/runs`);
  expect(refused.ok()).toBe(false);
  expect(await refused.text()).toContain("Pick the project folder");

  // Only a command-line model can edit files.
  await edit(request, id, (g) => {
    g.nodes.find((n) => n.id === "explain")!.config.model = "claude-code/sonnet";
  });
  await page.goto(`/workflows/${id}`);
  await page.getByRole("button", { name: "Open settings for Explain it" }).click();
  await expect(allowEdits).toBeVisible();
});

test("Explain a project folder runs on an API model and posts what it read from the folder", async ({ page, request }) => {
  const id = await createFromMenu(page, "Explain a project folder");
  await edit(request, id, (g) => {
    const explain = g.nodes.find((n) => n.id === "explain")!;
    explain.config.model = "mock/files";
    explain.config.folder = FOLDER;
  });

  const started = await request.post(`/api/workflows/${id}/runs`);
  expect(started.status(), await started.text()).toBe(202);
  const { runId } = await started.json();
  await expect.poll(async () => (await (await request.get(`/api/workflow-runs/${runId}`)).json()).state, { timeout: 30_000 }).toBe("succeeded");

  const read = "export function greet(name: string)";
  const explain = await (await request.get(`/api/workflow-runs/${runId}?node=explain`)).json();
  expect(explain.output.text).toContain(read);

  const post = await (await request.get(`/api/workflow-runs/${runId}?node=post`)).json();
  await openChat(page, post.output.conversationId);
  await expect(page.getByText(read, { exact: false }).first()).toBeVisible();
});
