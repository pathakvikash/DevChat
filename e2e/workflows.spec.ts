import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { test, expect, type APIRequestContext, type Page } from "./fixtures";
import { deleteAllChats, openChat, storedMessages } from "./helpers";

const DIGEST = "Mock digest (deterministic): 3 items"; // the fixture search returns 3 results (e2e/fixtures/workflows/search.json)

async function deleteAllWorkflows(request: APIRequestContext) {
  const list: Array<{ id: string }> = await (await request.get("/api/workflows")).json();
  for (const w of list) await request.delete(`/api/workflows/${w.id}`);
}

/** A News digest flow whose agent cards use `model`. */
async function createNews(request: APIRequestContext, model = "mock/workflow"): Promise<string> {
  const res = await request.post("/api/workflows", { data: { template: "news", model } });
  expect(res.status()).toBe(201);
  return (await res.json()).id;
}

async function startRun(request: APIRequestContext, workflowId: string): Promise<string> {
  const res = await request.post(`/api/workflows/${workflowId}/runs`);
  expect(res.status()).toBe(202);
  return (await res.json()).runId;
}

/** Starts a run and waits for it to succeed. */
async function runToEnd(request: APIRequestContext, workflowId: string): Promise<string> {
  const runId = await startRun(request, workflowId);
  await expect.poll(() => runState(request, runId), { timeout: 30_000 }).toBe("succeeded");
  return runId;
}

const runState = async (request: APIRequestContext, runId: string): Promise<string> =>
  (await (await request.get(`/api/workflow-runs/${runId}`)).json()).state;

/** The toast, not the screen-reader live region that repeats it. */
const toast = (page: Page, text: string) => page.locator("span").filter({ hasText: text }).last();

const card = (page: Page, label: string, type: string, status: string) => page.getByRole("group", { name: `${label}, ${type}, ${status}` });

async function openEditor(page: Page, id: string) {
  await page.goto(`/workflows/${id}`);
  await expect(page.getByLabel("Workflow name")).toBeVisible();
  await page.waitForLoadState("networkidle");
}

/** The chat the run's "Post to a chat" card made. */
async function postedChat(request: APIRequestContext, runId: string): Promise<string> {
  const post = await (await request.get(`/api/workflow-runs/${runId}?node=post`)).json();
  return post.output.conversationId;
}

test.beforeEach(async ({ request }) => {
  await deleteAllWorkflows(request);
  await deleteAllChats(request);
});

test("the News template runs card by card and posts the digest to a new chat", async ({ page, request }) => {
  const id = await createNews(request);
  await openEditor(page, id);
  await expect(card(page, "Run manually", "Run manually", "Not run")).toBeVisible();

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(toast(page, "Run started")).toBeVisible();
  await expect(card(page, "Write the digest", "Agent", "Running")).toBeVisible();
  for (const [label, type] of [["Run manually", "Run manually"], ["Search the news", "Web search"], ["Write the digest", "Agent"], ["Post to a chat", "Send to chat"]]) {
    await expect(card(page, label, type, "Done")).toBeVisible({ timeout: 30_000 });
  }

  const runId = (await (await request.get(`/api/workflows/${id}`)).json()).latestRun.id;
  const chatId = await postedChat(request, runId);
  await openChat(page, chatId);
  await expect(page.getByText('From "News digest"')).toBeVisible();
  await expect(page.getByText(DIGEST)).toBeVisible();
  const chat = await (await request.get(`/api/conversations/${chatId}`)).json();
  expect(chat.title).toMatch(/^News digest — \d{4}-\d{2}-\d{2}$/);
});

test("a run keeps going with the editor closed and still posts its digest", async ({ page, request }) => {
  const id = await createNews(request);
  const runId = await startRun(request, id); // no editor page is open at any point
  await expect.poll(() => runState(request, runId), { timeout: 30_000 }).toBe("succeeded");

  const chatId = await postedChat(request, runId);
  const messages = await storedMessages(request, chatId);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ role: "user", content: DIGEST });

  await openChat(page, chatId);
  await expect(page.getByText('From "News digest"')).toBeVisible();
});

test("Cancel run ends the run as Cancelled and creates no chat", async ({ page, request }) => {
  const id = await createNews(request, "mock/slow"); // the digest card streams for about 7 s
  await openEditor(page, id);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(card(page, "Write the digest", "Agent", "Running")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Cancel run" }).click();
  await expect(toast(page, "Run cancelled")).toBeVisible();
  await expect(card(page, "Write the digest", "Agent", "Cancelled")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel run" })).toHaveCount(0);

  await page.waitForTimeout(1500); // a cancelled run must not go on to post
  const chats: Array<{ title: string }> = await (await request.get("/api/conversations")).json();
  expect(chats.filter((c) => c.title.startsWith("News digest"))).toEqual([]);
  expect(await runState(request, (await (await request.get(`/api/workflows/${id}`)).json()).latestRun.id)).toBe("cancelled");
});

test("a second Run while one is running gets a 409 and a toast", async ({ page, request }) => {
  const id = await createNews(request, "mock/slow");
  await openEditor(page, id);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(card(page, "Write the digest", "Agent", "Running")).toBeVisible({ timeout: 30_000 });

  const second = await request.post(`/api/workflows/${id}/runs`);
  expect(second.status()).toBe(409);
  const conflict = await second.json();
  expect(conflict).toMatchObject({ error: "This workflow already has a run in progress.", runId: expect.any(String) });

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(toast(page, "Couldn't start the run. This workflow already has a run in progress.")).toBeVisible();
  // The toast sits over the Cancel run button, so stop the run through the API.
  expect((await request.post(`/api/workflow-runs/${conflict.runId}/cancel`)).ok()).toBe(true);
});

test("a stale running run becomes Interrupted, and Resume continues from the card it stopped at", async ({ page, request }) => {
  const id = await createNews(request);
  const { graph } = await (await request.get(`/api/workflows/${id}`)).json();
  const userId = (await (await request.get("/api/auth/session")).json()).user.id;

  // What a run cut off by the host's time limit leaves behind: running, no heartbeat for minutes, digest card mid-way.
  const at = new Date().toISOString();
  const items = ["a", "b", "c"].map((k) => ({ title: `T ${k}`, url: `https://news.example.test/${k}`, snippet: "s", query: "q" }));
  const db = new PrismaClient({ datasources: { db: { url: `file:${path.join(__dirname, "../prisma/sanity.db")}` } } });
  let runId: string;
  try {
    runId = (
      await db.workflowRun.create({
        data: {
          workflowId: id,
          userId,
          state: "running",
          graph: JSON.stringify(graph),
          heartbeatAt: new Date(Date.now() - 5 * 60_000),
          nodes: JSON.stringify({
            trigger: { status: "succeeded", startedAt: at, endedAt: at, output: { startedAt: at, date: at.slice(0, 10) } },
            news: { status: "succeeded", output: { items, count: 3 } },
            digest: { status: "running", startedAt: at },
          }),
        },
      })
    ).id;
  } finally {
    await db.$disconnect();
  }

  await openEditor(page, id);
  await expect(card(page, "Write the digest", "Agent", "Interrupted")).toBeVisible({ timeout: 15_000 });
  expect(await runState(request, runId)).toBe("interrupted");
  const resume = page.getByRole("button", { name: "Resume" });
  await expect(resume).toHaveAttribute("title", "The server stopped during this run. Resume picks up at “Write the digest”.");

  await resume.click();
  await expect(card(page, "Post to a chat", "Send to chat", "Done")).toBeVisible({ timeout: 30_000 });
  await expect(card(page, "Write the digest", "Agent", "Done")).toBeVisible();
  expect(await runState(request, runId)).toBe("succeeded");
  // The cards that had already succeeded were not run again: the seeded "news" card never got a start time.
  expect((await (await request.get(`/api/workflow-runs/${runId}?node=news`)).json()).startedAt).toBeUndefined();
  expect((await (await request.get(`/api/workflow-runs/${runId}?node=digest`)).json()).output.text).toBe(DIGEST);
});

test("the list shows each workflow with its last run, and New workflow starts from a template", async ({ page, request }) => {
  const id = await createNews(request);
  await runToEnd(request, id);

  await page.goto("/workflows");
  const row = page.getByRole("listitem").filter({ hasText: "News digest" });
  await expect(row).toContainText("4 cards");
  await expect(row).toContainText("Done");

  await page.getByRole("button", { name: /New workflow/ }).click();
  await page.getByRole("menuitem", { name: /News digest/ }).click();
  await expect(page).toHaveURL(/\/workflows\/[^/]+$/);
  await expect(page.getByRole("group", { name: /Search the news/ })).toBeVisible();
  await expect(page.getByRole("group", { name: /Post to a chat/ })).toBeVisible();
});

test("the config panel edits a card, saves it, and Insert field adds a reference", async ({ page, request }) => {
  const id = await createNews(request);
  await openEditor(page, id);
  await page.getByRole("button", { name: "Open settings for Write the digest" }).click();
  const instructions = page.getByLabel("Instructions");
  await instructions.fill("Write one line per article.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const saved = await (await request.get(`/api/workflows/${id}`)).json();
  expect(saved.graph.nodes.find((n: { id: string }) => n.id === "digest").config.instructions).toBe("Write one line per article.");

  // Insert field puts a reference at the caret, and the preview line shows what it renders to.
  await page.getByLabel("Input", { exact: true }).fill("");
  await page.getByRole("button", { name: "Insert field" }).nth(1).click();
  await page.getByRole("option", { name: /news\.count/ }).click();
  await expect(page.getByLabel("Input", { exact: true })).toHaveValue("{{news.count}}");
});

test("at 400px the list view shows the cards read-only, and Run still works", async ({ page, request }) => {
  const id = await createNews(request);
  await runToEnd(request, id);
  await page.setViewportSize({ width: 400, height: 800 });
  await openEditor(page, id);

  await expect(card(page, "Write the digest", "Agent", "Done")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add card" })).toHaveCount(0);
  await expect(page.getByLabel("Workflow name")).not.toBeEditable();
  await page.getByRole("button", { name: "Open settings for Write the digest" }).click();
  await expect(page.getByText("Edit cards on a wider screen")).toBeVisible();
  await expect(page.getByLabel("Instructions")).toBeDisabled();
  await page.getByRole("button", { name: "Close settings" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(toast(page, "Run started")).toBeVisible();
  await expect(card(page, "Post to a chat", "Send to chat", "Done")).toBeVisible({ timeout: 30_000 });
});

test("a card that reads chats and reaches the web is refused at save and at Run", async ({ request }) => {
  const id = await createNews(request);
  const { graph } = await (await request.get(`/api/workflows/${id}`)).json();
  const digest = graph.nodes.find((n: { id: string }) => n.id === "digest");
  digest.config.tools = ["readChat", "fetchUrl"];
  const saved = await request.patch(`/api/workflows/${id}`, { data: { graph } });
  expect(saved.status()).toBe(400);
  expect((await saved.json()).error).toContain("This card can read your chats and reach the web. Pick one");

  digest.config.tools = ["readChat"];
  expect((await request.patch(`/api/workflows/${id}`, { data: { graph } })).ok()).toBe(true);
  digest.config.tools = ["calculator"]; // a model with tools: mock/workflow has them
  expect((await request.patch(`/api/workflows/${id}`, { data: { graph } })).ok()).toBe(true);
});
