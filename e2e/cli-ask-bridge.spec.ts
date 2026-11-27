import { test, expect } from "./fixtures";
import { createChat, openChat } from "./helpers";

// Claude Code's own permission cards need the real CLI, which mock/* models do not run; the bridge is
// covered by src/lib/__tests__/cliApprovals*.test.ts. Here: confirming each change says changes need OK.
test("Confirm each change: the composer says changes need your OK", async ({ page, request }) => {
  const id = await createChat(request, { title: "Ask copy", model: "mock/write" });
  await openChat(page, id);
  const options = page.getByRole("button", { name: "Mode options" }).first();
  await options.click();
  await page.getByLabel("Confirm each change").first().check();
  await options.click();
  await expect(page.getByPlaceholder("Agent: changes need your OK")).toBeVisible();
});
