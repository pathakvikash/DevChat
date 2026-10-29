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

describe("mock/talker", () => {
  const sendTool = [{ type: "function", name: "sendToChat", inputSchema: { type: "object" } }];
  const sent = { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "sendToChat", input: {} }] };
  const sentResult = {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: "c1", toolName: "sendToChat", output: { type: "text", value: "Delivered." } }],
  };

  async function talk(prompt: unknown[], tools?: unknown[]) {
    const model = mockModelConfig("mock/talker")!.model as any;
    const { content } = await model.doGenerate({ prompt, tools });
    return content;
  }

  it("sends a ping to the side chat with sendToChat when it is offered", async () => {
    const content = await talk([user("ping the side chat")], sendTool);
    expect(content).toEqual([expect.objectContaining({ type: "tool-call", toolName: "sendToChat" })]);
    expect(JSON.parse(content[0].input)).toEqual({ to: "side", message: "ping from main" });
  });

  it("answers sent once the tool has run, and without the tool", async () => {
    expect(await talk([user("ping the side chat"), sent, sentResult], sendTool)).toEqual([{ type: "text", text: "sent" }]);
    expect(await talk([user("ping the side chat")])).toEqual([{ type: "text", text: "sent" }]);
  });
});
