import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { test, expect, type Page } from "./fixtures";
import { createChat, openChat } from "./helpers";

const tool = (name: string, readOnly: boolean) => ({ name, description: `${name} tool`, inputSchema: {}, readOnly });
const app = {
  id: "printpro3d", name: "Print Pro 3D", baseUrl: "https://printpro3d.example", description: "3D models", goodFor: "Generate 3D models",
  mcpUrl: "https://printpro3d.example/api/mcp", auth: "orrery-jwt", capabilities: ["job"], deepLinks: {}, permission: "actions",
  manifestVersion: 1, approved: true, status: "ok", tools: [tool("list_models", true), tool("order_print", false)],
};
const preview = {
  manifest: { ...app, icon: undefined, mcp: { url: app.mcpUrl }, goodFor: app.goodFor },
  origin: "https://printpro3d.example", tools: app.tools, warnings: ["Icon is missing"],
};

async function stubApps(page: Page, list: unknown[]) {
  await page.route("**/api/apps?all=1", (r) => r.fulfill({ json: list }));
  await page.route("**/api/apps", (r) => {
    if (r.request().method() === "POST") return r.fulfill({ status: 201, json: { app, secret: "test-secret-123" } });
    return r.fulfill({ json: list });
  });
  await page.route("**/api/apps/preview", (r) => r.fulfill({ json: preview }));
}

test("owner adds an app: review card, then the secret is shown once", async ({ page }) => {
  await stubApps(page, []);
  await page.goto("/settings/apps");
  await expect(page.getByText("No apps yet")).toBeVisible();

  await page.getByLabel("App URL").fill("https://printpro3d.example");
  await page.getByRole("button", { name: "Check app" }).click();
  const review = page.getByTestId("app-review");
  await expect(review.getByText("Print Pro 3D")).toBeVisible();
  await expect(review.getByText("Can take actions")).toBeVisible();
  await expect(review.getByText("order_print", { exact: true })).toBeVisible();
  await expect(review.getByText("Icon is missing")).toBeVisible();

  const post = page.waitForRequest((r) => r.url().endsWith("/api/apps") && r.method() === "POST");
  await review.getByRole("button", { name: "Approve and add" }).click();
  expect((await post).postDataJSON()).toEqual({ url: "https://printpro3d.example", approve: true });

  const box = page.getByTestId("app-secret-box");
  await expect(box).toContainText("ORRERY_APP_SECRET=test-secret-123");
  await expect(box).toContainText("ORRERY_ISSUER=orrery");
  await expect(box).toContainText("will not be shown again");
  await box.getByRole("button", { name: "I have saved it" }).click();
  await expect(page.getByText("test-secret-123")).toHaveCount(0);
});

test("a 403 on management calls turns the page read-only", async ({ page }) => {
  await page.route("**/api/apps?all=1", (r) => r.fulfill({ json: [app] }));
  await page.route("**/api/apps/preview", (r) => r.fulfill({ status: 403, json: { error: "Owner only" } }));
  await page.goto("/settings/apps");
  await expect(page.getByTestId("app-row-printpro3d")).toBeVisible();
  await page.getByLabel("App URL").fill("https://printpro3d.example");
  await page.getByRole("button", { name: "Check app" }).click();
  await expect(page.getByRole("note")).toContainText("Only the server owner");
  await expect(page.getByLabel("App URL")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove Print Pro 3D" })).toHaveCount(0);
});

test("the sidebar lists apps and hides the section when there are none", async ({ page, request }) => {
  await page.route("**/api/apps", (r) => r.fulfill({ json: [app] }));
  // The sidebar is only on chat pages; the home page hides it.
  await openChat(page, await createChat(request, { title: "Apps sidebar" }));
  const link = page.getByTestId("sidebar-apps").getByRole("link", { name: /Print Pro 3D/ });
  await expect(link).toHaveAttribute("href", "/api/apps/printpro3d/go?link=home");
  await expect(link).toHaveAttribute("target", "_blank");

  await page.unroute("**/api/apps");
  await page.route("**/api/apps", (r) => r.fulfill({ json: [] }));
  await page.reload();
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();
  await expect(page.getByTestId("sidebar-apps")).toHaveCount(0);
});

// A real sibling app on localhost (the dev server accepts http://127.0.0.1): manifest plus a stateless MCP endpoint.
// `requireToken` makes the MCP endpoint answer 401 to unsigned calls, like an `orrery-jwt` app before it has its secret.
async function startApp(id: string, requireToken: boolean): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (req.url === "/.well-known/orrery-app.json") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({
        manifestVersion: 1, id, name: `Real ${id}`, baseUrl: origin, description: "A real local app", goodFor: "Tests",
        mcp: { url: `${origin}/api/mcp` }, auth: requireToken ? "orrery-jwt" : "none", capabilities: [], deepLinks: {}, permission: "read",
      }));
    }
    if (req.url === "/api/mcp") {
      if (requireToken && !req.headers.authorization) { res.statusCode = 401; return res.end("unauthorized"); }
      const mcp = new McpServer({ name: id, version: "1.0.0" });
      mcp.registerTool("lookup", { description: "Look something up", annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: "text", text: "ok" }] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { void transport.close(); void mcp.close(); });
      await mcp.connect(transport);
      let raw = "";
      for await (const chunk of req) raw += chunk;
      return transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

test("real /api/apps routes: a registered app lists with its tool count and the page does not crash", async ({ page, request }) => {
  const upstream = await startApp("e2e-real-app", false);
  try {
    await page.goto("/settings/apps");
    await page.getByLabel("App URL").fill(upstream.url);
    await page.getByRole("button", { name: "Check app" }).click();
    const review = page.getByTestId("app-review");
    await expect(review.getByText("Tools (1)")).toBeVisible();
    await review.getByRole("button", { name: "Approve and add" }).click();
    await page.getByTestId("app-secret-box").getByRole("button", { name: "I have saved it" }).click();
    const row = page.getByTestId("app-row-e2e-real-app");
    await expect(row).toContainText("1 tool");
    await page.reload();
    await expect(page.getByTestId("app-row-e2e-real-app")).toContainText("1 tool");
  } finally {
    await request.delete("/api/apps/e2e-real-app");
    upstream.server.close();
  }
});

test("real preview: an app that needs a signed request says tools are listed after approval, not Tools (0)", async ({ page }) => {
  const upstream = await startApp("e2e-signed-app", true);
  try {
    await page.goto("/settings/apps");
    await page.getByLabel("App URL").fill(upstream.url);
    await page.getByRole("button", { name: "Check app" }).click();
    const review = page.getByTestId("app-review");
    await expect(review.getByTestId("tools-unavailable")).toHaveText("Tools are listed after you approve the app (this app requires a signed request).");
    await expect(review.getByText("Tools (0)")).toHaveCount(0);
  } finally {
    upstream.server.close();
  }
});
