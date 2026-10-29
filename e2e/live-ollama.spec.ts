import { test, expect } from "@playwright/test";
import { createChat, messages, openChat, regenerateButtons, send } from "./helpers";

// Optional: talks to a real local model. Run with `npm run sanity -- --live`.
const OLLAMA = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

test.describe("real model via local Ollama", { tag: "@live" }, () => {
  let model: string | undefined;

  test.beforeAll(async () => {
    try {
      const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
      model = res.ok ? (await res.json()).models?.[0]?.name : undefined;
    } catch {
      model = undefined;
    }
  });

  test.beforeEach(() => {
    test.skip(!model, `Ollama is not reachable (or has no models) at ${OLLAMA}`);
  });

  test("a real model answers a chat message", async ({ page, request }) => {
    test.setTimeout(180_000); // the first call may have to load the model
    const id = await createChat(request, { title: "Live test", model: `ollama/${model}` });
    await openChat(page, id);

    await send(page, "Reply with one short sentence.");
    await expect(regenerateButtons(page)).toHaveCount(1, { timeout: 150_000 });
    await expect(messages(page)).toHaveCount(2);
    expect((await messages(page).nth(1).innerText()).trim().length).toBeGreaterThan(0);
  });
});
