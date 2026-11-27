import { test, expect, type Page } from "./fixtures";
import { createChat, openChat, send, storedMessages } from "./helpers";

// A deployed Orrery cannot run Claude Code itself; the page uses the owner's local bridge instead. Both sides are stubbed:
// /api/folders says "no host tools" (what Vercel answers), and the bridge on 127.0.0.1:47321 is a route handler.
const TOKEN = "t".repeat(43);
const REPLY = "Hello from the local bridge";
const sse = (chunks: object[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
const CHAT_BODY = sse([
  { type: "start" },
  { type: "start-step" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Hello from the " },
  { type: "text-delta", id: "t1", delta: "local bridge" },
  { type: "text-end", id: "t1" },
  { type: "finish-step" },
  { type: "finish" },
]);

async function stubDeployedWithBridge(page: Page, chatBodies: unknown[] = []) {
  // A deployment has no Claude Code of its own: the picker must show only the bridge's models, even where this
  // machine has `claude` installed and the dev server lists it.
  await page.route("**/api/models", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const json = await (await route.fetch()).json();
    return route.fulfill({ json: { ...json, models: json.models.filter((m: { id: string }) => !m.id.startsWith("claude-code/")) } });
  });
  await page.route("**/api/folders", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { folders: [], hostTools: true, reason: "Working folders only work when Orrery runs on your own machine." } })
      : route.fallback(),
  );
  await page.route("http://127.0.0.1:47321/**", async (route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": new URL(page.url()).origin, "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-private-network": "true", vary: "Origin" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.headers()["authorization"] !== `Bearer ${TOKEN}`) return route.fulfill({ status: 401, headers: cors, json: { error: "Missing or wrong token" } });
    const path = new URL(req.url()).pathname;
    if (path === "/health") return route.fulfill({ headers: cors, json: { protocol: 1, version: "0.1.0", claude: true } });
    if (path === "/models") return route.fulfill({ headers: cors, json: { models: [{ id: "claude-code/sonnet", name: "Bridge Sonnet", provider: "Claude Code", contextWindow: 200000 }] } });
    if (path === "/folders") return route.fulfill({ headers: cors, json: { folders: [], hostTools: true, reason: null } });
    if (path === "/chat") {
      chatBodies.push(req.postDataJSON());
      return route.fulfill({ headers: { ...cors, "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" }, body: CHAT_BODY });
    }
    return route.fulfill({ status: 404, headers: cors, json: { error: "Not found" } });
  });
}

test("pair on a deployment, pick the bridge model, stream a reply, and see it saved after a reload", async ({ page, request }) => {
  const chatBodies: any[] = [];
  await stubDeployedWithBridge(page, chatBodies);

  // Pair in Settings.
  await page.goto("/settings");
  const status = page.getByRole("main").getByTestId("bridge-status");
  await expect(status).toHaveText("Not paired. Paste the token the bridge printed.");
  await page.getByRole("main").getByLabel("Bridge token").fill(TOKEN);
  await page.getByRole("main").getByRole("button", { name: "Save", exact: true }).click();
  await expect(status).toContainText("Connected");

  // Pick the bridge model (listed "via local bridge").
  const id = await createChat(request, { title: "Bridge chat" });
  await openChat(page, id);
  await page.getByRole("button", { name: /^Mock Echo/ }).click();
  await page.getByRole("button", { name: "Claude Code", exact: true }).click();
  await expect(page.getByText("via local bridge")).toBeVisible();
  await page.getByRole("button", { name: /^Bridge Sonnet/ }).click();
  await expect.poll(async () => (await (await request.get(`/api/conversations/${id}`)).json()).model).toBe("claude-code/sonnet");
  await expect(page.getByTestId("bridge-notice")).toContainText("No folder selected: Claude Code runs with no tools.");

  // Send: the text streams from the bridge, then the turn is saved through the messages route.
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/conversations/${id}/messages`) && r.request().method() === "POST");
  await send(page, "hello bridge");
  await expect(page.getByText(REPLY)).toBeVisible();
  expect((await saved).ok()).toBe(true);
  expect(chatBodies).toHaveLength(1);
  expect(chatBodies[0]).toMatchObject({ conversationId: id, model: "claude-code/sonnet", mode: "chat" });
  expect(chatBodies[0]).not.toHaveProperty("folder");

  // Reload: the saved turn comes back from the server.
  await page.reload();
  await expect(page.getByText(REPLY)).toBeVisible();
  const rows = await storedMessages(request, id);
  expect(rows.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(rows[0].content).toBe("hello bridge");
});

test("a bridge model with the bridge offline says why instead of using another model", async ({ page, request }) => {
  await stubDeployedWithBridge(page);
  await page.route("http://127.0.0.1:47321/**", (route) => route.abort("connectionrefused"));
  await page.addInitScript((t) => localStorage.setItem("orrery:bridge-token", t), TOKEN);
  const id = await createChat(request, { title: "Offline bridge", model: "claude-code/sonnet" });
  await openChat(page, id);
  await send(page, "anyone there");
  await expect(page.getByTestId("bridge-notice")).toContainText("Start the bridge on this computer: npm run bridge");
});
