import { test, expect, type Page } from "./fixtures";
import { createChat, messages, openChat, regenerateButtons, send, storedMessages } from "./helpers";

/** The composer's Ask | Agent switch. Stored "chat" is Ask; stored "ask" and "agent" are both Agent. */
const mode = (page: Page, name: "Ask" | "Agent") =>
  page.getByRole("radiogroup", { name: "Conversation mode" }).first().getByRole("radio", { name });

/** Flip a checkbox in the "Mode options" menu, then close the menu. */
async function toggleOption(page: Page, label: "Confirm each change" | "Plan first") {
  const options = page.getByRole("button", { name: "Mode options" }).first();
  await options.click();
  await page.getByLabel(label).first().check();
  await options.click();
}
const confirmEach = (page: Page) => toggleOption(page, "Confirm each change");
const planFirst = (page: Page) => toggleOption(page, "Plan first");
const planLabel = (page: Page) => page.getByTestId("mode-plan-label");

const approvalCard = (page: Page) => page.getByRole("group", { name: /Needs your OK/ });

test("the mode is stored per chat and survives a reload", async ({ page, request }) => {
  const a = await createChat(request, { title: "Mode A" });
  const b = await createChat(request, { title: "Mode B" });
  await openChat(page, a);
  await expect(mode(page, "Ask")).toHaveAttribute("aria-checked", "true");

  await planFirst(page);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(planLabel(page)).toBeVisible();

  await openChat(page, b);
  await expect(mode(page, "Ask")).toHaveAttribute("aria-checked", "true");
  await expect(planLabel(page)).toHaveCount(0);
});

test("Ask mode: Deny keeps the artifact out of the chat", async ({ page, request }) => {
  const id = await createChat(request, { title: "Ask deny", model: "mock/write" });
  await openChat(page, id);
  await confirmEach(page);

  await send(page, "make a note for me");
  await expect(approvalCard(page)).toContainText('Create artifact "Mock note"');
  await approvalCard(page).getByRole("button", { name: "Deny" }).click();

  await expect(regenerateButtons(page)).toHaveCount(1);
  const reply = messages(page).nth(1);
  await expect(reply).toContainText("Mock write reply");
  await expect(reply).toContainText("Denied");
  await expect(reply.getByText("Mock note", { exact: true })).toHaveCount(0);
});

test("Ask mode: Allow runs the tool, and Allow for this chat skips the next card", async ({ page, request }) => {
  const id = await createChat(request, { title: "Ask allow", model: "mock/write" });
  await openChat(page, id);
  await confirmEach(page);

  await send(page, "first note");
  await approvalCard(page).getByRole("button", { name: "Allow for this chat" }).click();
  await expect(regenerateButtons(page)).toHaveCount(1);
  await expect(messages(page).nth(1).getByText("Mock note", { exact: true })).toBeVisible();

  await send(page, "second note");
  await expect(regenerateButtons(page)).toHaveCount(2);
  await expect(approvalCard(page)).toHaveCount(0);
  await expect(messages(page).nth(3).getByText("Mock note", { exact: true })).toBeVisible();
});

test("Ask mode: a card left unanswered reads Not answered after the next message", async ({ page, request }) => {
  const id = await createChat(request, { title: "Ask ignore", model: "mock/write" });
  await openChat(page, id);
  await confirmEach(page);

  await send(page, "first note");
  await expect(approvalCard(page)).toHaveCount(1);
  await send(page, "never mind, something else");
  await expect(page.getByText("Not answered", { exact: true })).toBeVisible();
});

test("/plan switches to Plan mode, and Approve plan runs it in Agent", async ({ page, request }) => {
  const id = await createChat(request, { title: "Plan approve", model: "mock/plan" });
  await openChat(page, id);

  await send(page, "/plan add a cache");
  await expect(planLabel(page)).toBeVisible();
  const plan = page.getByRole("group", { name: "Plan: Add a cache" });
  await expect(plan).toContainText("Read the fetch path");

  await plan.getByRole("radio", { name: "Agent" }).click();
  await plan.getByRole("button", { name: "Approve plan" }).click();
  await expect(plan).toContainText("Approved · running in Agent mode");
  await expect(mode(page, "Agent")).toHaveAttribute("aria-checked", "true");
  // The approval is a visible message, and the reply to it follows.
  await expect(messages(page).nth(2)).toContainText("Approved. Run the plan.");
  await expect(messages(page).nth(3)).toContainText("Mock plan reply");
});

test("a model without tools gets Approve plan under its reply in Plan mode", async ({ page, request }) => {
  const id = await createChat(request, { title: "Plan no tools", model: "mock/notools" });
  await openChat(page, id);
  await planFirst(page);

  await send(page, "plan a small refactor of the login page");
  await expect(regenerateButtons(page)).toHaveCount(1);
  const reply = messages(page).nth(1);
  await expect(reply).toContainText("This model can't use tools");
  await reply.getByRole("button", { name: "Approve plan" }).click();

  await expect(messages(page).nth(2)).toContainText("Approved. Carry out the plan.");
  await expect(mode(page, "Ask")).toHaveAttribute("aria-checked", "true");
});

test("a model without tools shows Agent disabled, and the tap says why", async ({ page, request }) => {
  const id = await createChat(request, { title: "Agent no tools", model: "mock/notools" });
  await openChat(page, id);

  const agent = mode(page, "Agent");
  await expect(agent).toHaveAttribute("aria-disabled", "true");
  // aria-disabled, not disabled: the tap still explains why. Playwright treats it as not enabled, so force the click.
  await agent.click({ force: true });
  await expect(agent).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("Needs a model that can use tools. Pick one with the wrench icon.")).toBeVisible();
});

test("Ask mode: a card answered after reload runs, and the reply keeps one id", async ({ page, request }) => {
  const id = await createChat(request, { title: "Ask reload", model: "mock/write" });
  await openChat(page, id);
  await confirmEach(page);

  await send(page, "first note");
  await expect(approvalCard(page)).toBeVisible();
  await page.reload();
  await page.waitForLoadState("networkidle");

  await approvalCard(page).getByRole("button", { name: "Allow", exact: true }).click();
  await expect(page.getByText("Mock write reply")).toBeVisible();
  await expect(messages(page).nth(1).getByText("Mock note", { exact: true })).toBeVisible();

  await expect.poll(async () => (await storedMessages(request, id)).length).toBe(2);
  const stored = await storedMessages(request, id);
  await expect(messages(page).nth(1)).toHaveAttribute("data-message-id", stored[1].id);
});
