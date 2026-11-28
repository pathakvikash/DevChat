import { test, expect } from "./fixtures";
import { createChat, openChat, regenerateButtons, send } from "./helpers";

test("the model picker lists the mock models and switches the chat's model", async ({ page, request }) => {
  const id = await createChat(request, { title: "Picker test" });
  await openChat(page, id);

  await page.getByRole("button", { name: /^Mock Echo/ }).click();
  await expect(page.getByText("Models", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mock", exact: true })).toBeVisible(); // provider tab
  for (const name of ["Mock Slow", "Mock Tool", "Mock No Tools", "Mock Summary"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
  }

  await page.getByRole("button", { name: /^Mock Slow/ }).click();
  await expect(page.getByText("Models", { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: /^Mock Slow/ })).toBeVisible();
  await expect
    .poll(async () => (await (await request.get(`/api/conversations/${id}`)).json()).model)
    .toBe("mock/slow");

  await page.reload();
  await expect(page.getByRole("button", { name: /^Mock Slow/ })).toBeVisible();
});

test("with five providers every provider tab is inside the open picker", async ({ page, request }) => {
  const model = (id: string, name: string, provider: string) => ({ id, name, provider, contextWindow: 8192, supportsTools: true, supportsVision: false, supportsThinking: false });
  await page.route("**/api/models", (r) =>
    r.fulfill({
      json: {
        models: [
          model("mock/echo", "Mock Echo", "Anthropic"),
          model("b/b", "B", "OpenAI"),
          model("c/c", "C", "Ollama"),
          model("d/d", "D", "LM Studio"),
          model("e/e", "E", "OpenRouter"),
        ],
      },
    }),
  );
  await openChat(page, await createChat(request, { title: "Five providers" }));
  await page.getByRole("button", { name: /^Mock Echo/ }).click();
  const panel = page.locator(".glass-panel-strong", { has: page.getByText("Models", { exact: true }) });
  const box = (await panel.boundingBox())!;
  for (const provider of ["Anthropic", "OpenAI", "Ollama", "LM Studio", "OpenRouter"]) {
    const tab = panel.getByRole("button", { name: provider, exact: true });
    await expect(tab).toBeVisible();
    const t = (await tab.boundingBox())!;
    expect(t.x, provider).toBeGreaterThanOrEqual(box.x);
    expect(t.x + t.width, provider).toBeLessThanOrEqual(box.x + box.width);
    // Reachable by keyboard: focusing it works and does not scroll the row.
    await tab.focus();
    await expect(tab).toBeFocused();
  }
});

test("a new chat never starts on a saved default model that is no longer listed", async ({ request }) => {
  const stale = "openrouter/some-lab/retired-model:free";
  try {
    expect((await request.put("/api/settings/keys", { data: { defaultModel: stale } })).ok()).toBeTruthy();
    const res = await request.post("/api/conversations", { data: { title: "Stale default" } }); // no model: the server picks
    expect(res.status()).toBe(201);
    const chat = await res.json();
    expect(chat.model).not.toBe(stale);
    expect(chat.model).toMatch(/^mock\//); // the first listed usable model here
    expect(chat.modelReplaced).toMatchObject({ from: stale, to: chat.model });
  } finally {
    await request.put("/api/settings/keys", { data: { defaultModel: "mock/echo" } });
  }
  // A listed default is kept, with nothing to report.
  const kept = await (await request.post("/api/conversations", { data: { title: "Kept default" } })).json();
  expect(kept.model).toBe("mock/echo");
  expect(kept.modelReplaced).toBeUndefined();
});

test("only models that support tools show the tools badge", async ({ page, request }) => {
  await openChat(page, await createChat(request));
  await page.getByRole("button", { name: /^Mock Echo/ }).click();

  const withTools = page.getByRole("button", { name: /^Mock Tool/ });
  const withoutTools = page.getByRole("button", { name: /^Mock No Tools/ });
  await expect(withTools.getByTitle("Supports tools")).toHaveCount(1);
  await expect(withoutTools.getByTitle("Supports tools")).toHaveCount(0);
});

test("a model without tool support is served without tools", async ({ page, request }) => {
  await openChat(page, await createChat(request, { model: "mock/notools" }));
  const response = page.waitForResponse((r) => r.url().endsWith("/api/chat"));
  await send(page, "hello there");
  const headers = (await response).headers();
  expect(headers["x-debug-model"]).toBe("mock/notools");
  expect(headers["x-debug-supports-tools"]).toBe("false");
  expect(headers["x-debug-use-tools"]).toBe("false");
  await expect(page.getByText("Mock reply without tools. You said: hello there")).toBeVisible();
  await expect(regenerateButtons(page)).toHaveCount(1);
});

test("a tool-capable model is served with tools", async ({ page, request }) => {
  await openChat(page, await createChat(request));
  const response = page.waitForResponse((r) => r.url().endsWith("/api/chat"));
  await send(page, "hello there");
  const headers = (await response).headers();
  expect(headers["x-debug-use-tools"]).toBe("true");
  expect(headers["x-debug-tools"]).toContain("calculator");
});
