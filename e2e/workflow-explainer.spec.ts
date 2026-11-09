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
  await expect(items).toHaveCount(4);
  await expect(items.nth(2)).toContainText("Explain a GitHub repo");
  await expect(items.nth(3)).toContainText("Explain a project folder");
  await expect(items.nth(3)).toContainText("Local");
  await expect(items.nth(3)).toBeEnabled();
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

test("Explain a project folder asks for a model and a folder until both are picked", async ({ page, request }) => {
  const id = await createFromMenu(page, "Explain a project folder");
  await edit(request, id, () => {});
  const open = async () => {
    await page.goto(`/workflows/${id}`);
    await page.getByRole("button", { name: "Open settings for Explain it" }).click();
    return page.getByRole("complementary", { name: "Explain it settings" });
  };
  const pickModel = "Pick a Claude Code or OpenCode model";
  const pickFolder = "Pick the project folder";

  // The folder field only appears once a command-line model is picked, so the panel asks for the model first.
  let panel = await open();
  await expect(panel.getByText(pickModel)).toBeVisible();

  // Run is refused with both messages.
  const refused = await request.post(`/api/workflows/${id}/runs`);
  expect(refused.ok()).toBe(false);
  const text = await refused.text();
  expect(text).toContain(pickModel);
  expect(text).toContain(pickFolder);

  await edit(request, id, (g) => {
    g.nodes.find((n) => n.id === "explain")!.config.model = "claude-code/sonnet";
  });
  panel = await open();
  await expect(panel.getByText(pickFolder)).toBeVisible();
  await expect(panel.getByText(pickModel)).toHaveCount(0);

  await edit(request, id, (g) => {
    g.nodes.find((n) => n.id === "explain")!.config.folder = FOLDER;
  });
  panel = await open();
  await expect(panel.getByText("Working folder", { exact: true })).toBeVisible();
  await expect(page.getByText(pickFolder)).toHaveCount(0);
  await expect(page.getByText(pickModel)).toHaveCount(0);
});
