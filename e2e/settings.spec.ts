import { test, expect } from "./fixtures";
import { PROVIDERS } from "../src/lib/providers";

test("the settings page loads with its sections and the saved default model", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings & Analytics" })).toBeVisible();
  for (const section of ["LLM Providers", "Default Model", "Auto-Compress", "MCP Servers", "Training Dataset Export", "Usage Statistics"]) {
    await expect(page.getByRole("heading", { name: section })).toBeVisible();
  }
  // auth.setup.ts saved mock/echo as the default model; the mock models are in the list.
  const defaultModel = page.locator("select").first();
  await expect(defaultModel).toHaveValue("mock/echo");
  await expect(defaultModel.locator("option", { hasText: "Mock Slow" })).toHaveCount(1);
  // No provider API keys. LM Studio is probed at its default local URL, so it reads "N models available"
  // on a machine that happens to run LM Studio; every other provider is "Not configured".
  const lmstudio = page.getByText("LM Studio", { exact: true }).locator("xpath=following-sibling::*[1]");
  await expect(lmstudio).toHaveText(/Not configured|\d+ models? available/);
  const lmNotConfigured = (await lmstudio.textContent()) === "Not configured" ? 1 : 0;
  await expect(page.getByText("Not configured")).toHaveCount(PROVIDERS.length - 1 + lmNotConfigured);
});

test("Save Settings confirms and the choice sticks", async ({ page, request }) => {
  await page.goto("/settings");
  await expect(page.locator("select").first()).toHaveValue("mock/echo");
  // In dev, Strict Mode loads the settings twice; the second load would overwrite a choice made too early.
  await page.waitForLoadState("networkidle");

  await page.locator("select").first().selectOption("mock/tool");
  await page.getByRole("button", { name: "Save Settings" }).click();
  await expect(page.getByText("Settings saved successfully.")).toBeVisible();
  const saved = await (await request.get("/api/settings/keys")).json();
  expect(saved.defaultModel).toBe("mock/tool");

  // New chats now start on the saved model; restore it afterwards for the other specs.
  const created = await (await request.post("/api/conversations", { data: { title: "Default model check" } })).json();
  expect(created.model).toBe("mock/tool");
  await request.put("/api/settings/keys", { data: { defaultModel: "mock/echo" } });
  await request.delete(`/api/conversations/${created.id}`);
});

test("the MCP servers page opens from settings", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("link", { name: "Manage" }).click();
  await expect(page).toHaveURL(/\/settings\/mcp$/);
});
