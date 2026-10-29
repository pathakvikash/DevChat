import { test, expect } from "@playwright/test";
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
