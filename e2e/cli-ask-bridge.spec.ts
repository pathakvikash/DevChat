import { test, expect, type Page } from "@playwright/test";
import { createChat, openChat } from "./helpers";

/** The header's mode switch (the sidebar has a compact copy of the same radio group). */
const mode = (page: Page, name: "Chat" | "Plan" | "Ask" | "Agent") =>
  page.getByRole("radiogroup", { name: "Conversation mode" }).first().getByRole("radio", { name });

// Claude Code's own permission cards need the real CLI, which mock/* models do not run; the bridge is
// covered by src/lib/__tests__/cliApprovals*.test.ts. Here: Ask on an API model says changes need OK.
test("Ask mode composer says changes need your OK", async ({ page, request }) => {
  const id = await createChat(request, { title: "Ask copy", model: "mock/write" });
  await openChat(page, id);
  await mode(page, "Ask").click();
  await expect(page.getByPlaceholder("Ask mode: changes need your OK")).toBeVisible();
});
