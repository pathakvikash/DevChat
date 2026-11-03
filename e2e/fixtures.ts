import { test as base, expect } from "@playwright/test";

export * from "@playwright/test";

// React's list-key warnings mean rows can be duplicated or dropped, so any test that triggers one fails.
const KEY_WARNING = /Encountered two children with the same key|Each child in a list should have a unique "key" prop/;

export const test = base.extend<{ reactKeyGuard: void }>({
  // `next dev` closes idle keep-alive sockets after 5s (only `next start` can change that), so a request sent on
  // one just then fails with ECONNRESET. A GET changes nothing, so it is safe to send once more.
  request: async ({ request }, provide) => {
    const get = request.get.bind(request);
    request.get = async (...args) => {
      try {
        return await get(...args);
      } catch (e) {
        if (!String(e).includes("ECONNRESET")) throw e;
        return get(...args);
      }
    };
    await provide(request);
  },
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
