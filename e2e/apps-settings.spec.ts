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
