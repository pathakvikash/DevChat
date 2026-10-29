import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mockModelConfig } from "@/lib/mockModels";

// The mock models exist only in sanity mode (see sanityMode.ts), so the test turns it on.
beforeEach(() => {
  vi.stubEnv("SANITY_TEST_AUTH", "1");
  vi.stubEnv("DATABASE_URL", "file:./prisma/sanity.db");
});
afterEach(() => vi.unstubAllEnvs());

const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });
const toolCall = { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "calculator", input: {} }] };
const toolResult = {
  role: "tool",
  content: [{ type: "tool-result", toolCallId: "mock-call-1", toolName: "calculator", output: { type: "text", value: "42" } }],
};

async function reply(prompt: unknown[]) {
  const model = mockModelConfig("mock/tool")!.model as any;
  const { content } = await model.doGenerate({ prompt });
  return content.map((c: { type: string }) => c.type);
}

describe("mock/tool turn rule", () => {
  it("calls the calculator for a question, then answers in text once the result is in", async () => {
    expect(await reply([user("what is 6 times 7?")])).toEqual(["tool-call"]);
    expect(await reply([user("what is 6 times 7?"), toolCall, toolResult])).toEqual(["text"]);
  });

  it("calls the calculator again for a second question", async () => {
    const first = [user("what is 6 times 7?"), toolCall, toolResult, { role: "assistant", content: [{ type: "text", text: "42" }] }];
    expect(await reply([...first, user("and 7 times 7?")])).toEqual(["tool-call"]);
  });

  it("answers a queued message in text without starting a new turn", async () => {
    expect(await reply([user("what is 6 times 7?"), toolCall, toolResult, user("queued: make it 7 times 7")])).toEqual(["text"]);
  });
});
