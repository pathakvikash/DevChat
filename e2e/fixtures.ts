import { test as base, expect } from "@playwright/test";

export * from "@playwright/test";

// React's list-key warnings mean rows can be duplicated or dropped, so any test that triggers one fails.
const KEY_WARNING = /Encountered two children with the same key|Each child in a list should have a unique "key" prop/;

export const test = base.extend<{ reactKeyGuard: void }>({
  reactKeyGuard: [
    async ({ context }, use) => {
      const hits: string[] = [];
      context.on("console", (m) => {
        if (m.type() === "error" && KEY_WARNING.test(m.text())) hits.push(m.text().split("\n")[0]);
      });
      await use();
      expect(hits, "React list-key warnings in the browser console").toEqual([]);
    },
    { auto: true },
  ],
});
