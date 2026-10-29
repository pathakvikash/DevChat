import { test, expect } from "@playwright/test";
import { createChat, messages, openChat, regenerateButtons, send, storedMessages } from "./helpers";

test("mock/subagent starts a helper, shows its card, and saves the helper as a child chat", async ({ page, request }) => {
  const id = await createChat(request, { title: "Sub-agent test", model: "mock/subagent" });
  await openChat(page, id);

  await send(page, "summarise my notes");
  await expect(regenerateButtons(page)).toHaveCount(1);

  const reply = messages(page).nth(1);
  const card = reply.getByRole("group", { name: "Sub-agent: Note reader" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Done");
  await expect(reply).toContainText("Mock sub-agent answer");

  // The helper's run is a kind=subagent child of this chat, with the brief and its reply.
  const children = await (await request.get(`/api/conversations/${id}/children?kind=subagent`)).json();
  expect(children).toHaveLength(1);
  expect(children[0]).toMatchObject({ kind: "subagent", title: "Note reader" });
  const transcript = await storedMessages(request, children[0].id);
  expect(transcript.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(transcript[0].content).toBe("Read the notes and summarise them.");
  expect(transcript[1].content).toContain("Mock helper report");

  await card.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${children[0].id}`));
});
