import { test, expect } from "./fixtures";
import { createChat, openChat, regenerateButtons, send } from "./helpers";

test("the Artifacts page lists an artifact from a chat and links to its preview and chat", async ({ page, request }) => {
  const id = await createChat(request, { title: "Artifacts index chat", model: "mock/artifact" });
  await openChat(page, id);
  await page.getByRole("radiogroup", { name: "Conversation mode" }).first().getByRole("radio", { name: "Agent" }).click();
  await send(page, "make the page");
  await expect(regenerateButtons(page)).toHaveCount(1);

  const list = await (await request.get(`/api/conversations/${id}/artifacts`)).json();
  const artifactId = list.artifacts[0].id;

  await page.goto("/artifacts");
  await expect(page.getByRole("heading", { name: "Artifacts", level: 1 })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "Artifacts index chat" }).first();
  await expect(row).toBeVisible();
  await expect(row.getByRole("link", { name: /Sandbox probe/ })).toHaveAttribute("href", `/artifact-preview/${id}/${artifactId}`);
  await expect(row.getByRole("link", { name: "Open chat" })).toHaveAttribute("href", `/c/${id}`);

  await page.getByRole("searchbox", { name: "Search artifacts" }).fill("zzz-no-such-artifact");
  await expect(page.getByText("No artifacts match your search.")).toBeVisible();
});
