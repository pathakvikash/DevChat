import { test, expect } from "@playwright/test";
import { createChat, messages, openChat, regenerateButtons, send } from "./helpers";

test("mock/tool calls the calculator and shows a tool card with its output", async ({ page, request }) => {
  const id = await createChat(request, { title: "Tool test", model: "mock/tool" });
  await openChat(page, id);

  await send(page, "what is 6 times 7?");
  await expect(regenerateButtons(page)).toHaveCount(1);

  const reply = messages(page).nth(1);
  const card = reply.getByRole("button", { name: /Tool: calculator/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText("done");
  await expect(reply).toContainText("The calculator returned 42");

  // Collapsed by default; expanding shows the real tool result.
  const output = reply.getByText("= 42", { exact: true });
  await expect(output).toBeHidden();
  await card.click();
  await expect(output).toBeVisible();
});

test("the tool card is still there after a reload", async ({ page, request }) => {
  const id = await createChat(request, { model: "mock/tool" });
  await openChat(page, id);
  await send(page, "calculate please");
  await expect(regenerateButtons(page)).toHaveCount(1);

  await page.reload();
  await page.waitForLoadState("networkidle");
  const card = messages(page).nth(1).getByRole("button", { name: /Tool: calculator/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText("done");
});
