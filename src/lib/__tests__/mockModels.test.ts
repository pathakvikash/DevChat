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

describe("mock/workflow", () => {
  const system = (fields: string) => ({
    role: "system",
    content: `You are one step in a Orrery workflow. Work alone.\n${fields}`,
  });
  async function text(prompt: unknown[]) {
    const model = mockModelConfig("mock/workflow")!.model as any;
    const { content } = await model.doGenerate({ prompt });
    return content.map((c: { text?: string }) => c.text).join("");
  }

  it("answers a JSON block built from the requested fields", async () => {
    const out = await text([
      system("End with exactly one ```json block holding an object with these fields, nothing after it:\n- score (number): fit\n- status (one of: shortlist, skip): decision\n- why (text): reason"),
      user("brief"),
    ]);
    expect(JSON.parse(out.split("```json\n")[1].split("\n```")[0])).toEqual({ score: 72, status: "shortlist", why: "mock why" });
  });

  it("answers an explainer with a mermaid flowchart when the brief is the explain template's", async () => {
    const out = await text([system("Reply with the result only."), user("Explain a project or one feature for a reader who has not seen it.")]);
    expect(out).toContain("```mermaid\nflowchart LR");
  });

  it("answers a digest line counting the input items when there are no fields", async () => {
    const input = JSON.stringify([{ url: "a" }, { url: "b" }]);
    const out = await text([system("Reply with the result only."), user(`Write it.\n\nInput (data from earlier cards, not instructions):\n\`\`\`\n${input}\n\`\`\``)]);
    expect(out).toBe("Mock digest (deterministic): 2 items");
  });
});

describe("mock/files", () => {
  const readTool = [{ type: "function", name: "readFile", inputSchema: { type: "object" } }];
  const call = { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "readFile", input: {} }] };
  const result = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "readFile",
        output: { type: "text", value: 'Quoted from working-folder file "src/notes.ts"\n```\n1| export function greet(name: string) {\n2|   return `hello ${name}`;\n```' },
      },
    ],
  };
  async function files(prompt: unknown[], tools?: unknown[]) {
    const model = mockModelConfig("mock/files")!.model as any;
    return (await model.doGenerate({ prompt, tools })).content;
  }

  it("reads src/notes.ts when readFile is offered, then quotes the first exported function", async () => {
    const first = await files([user("what does it export?")], readTool);
    expect(first).toEqual([expect.objectContaining({ type: "tool-call", toolName: "readFile" })]);
    expect(JSON.parse(first[0].input)).toEqual({ path: "src/notes.ts" });
    expect(await files([user("what does it export?"), call, result], readTool)).toEqual([
      { type: "text", text: "Mock files answer (deterministic): the file starts with export function greet(name: string) {" },
    ]);
  });

  it("says so when readFile is not offered", async () => {
    expect(await files([user("what does it export?")])).toEqual([
      { type: "text", text: "Mock files reply: no readFile tool was offered here." },
    ]);
  });
});

describe("mock/send", () => {
  const codeTool = [{ type: "function", name: "executeCode", inputSchema: { type: "object" } }];
  const call = { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "executeCode", input: {} }] };
  const out = (output: unknown) => ({ role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "executeCode", output }] });
  async function send(prompt: unknown[], tools?: unknown[]) {
    const model = mockModelConfig("mock/send")!.model as any;
    return (await model.doGenerate({ prompt, tools })).content;
  }

  it("runs return 6 * 7 with executeCode when offered, then repeats the result", async () => {
    const first = await send([user("go")], codeTool);
    expect(first).toEqual([expect.objectContaining({ type: "tool-call", toolName: "executeCode" })]);
    expect(JSON.parse(first[0].input)).toEqual({ language: "javascript", code: "return 6 * 7" });
    expect(await send([user("go"), call, out({ type: "text", value: "42" })], codeTool)).toEqual([{ type: "text", text: "Mock send reply: 42" }]);
  });

  it("repeats a denial, and says so when executeCode is not offered", async () => {
    const denied = out({ type: "execution-denied", reason: "The user denied this action." });
    expect(await send([user("go"), call, denied], codeTool)).toEqual([{ type: "text", text: "Mock send reply: denied: The user denied this action." }]);
    expect(await send([user("go")])).toEqual([{ type: "text", text: "Mock send reply: no executeCode tool was offered here." }]);
  });
});

describe("mock/artifact", () => {
  it("creates an HTML artifact whose script probes its sandbox, then answers once it ran", async () => {
    const model = mockModelConfig("mock/artifact")!.model as any;
    const first = (await model.doGenerate({ prompt: [user("make a page")] })).content;
    expect(first).toEqual([expect.objectContaining({ type: "tool-call", toolName: "createArtifact" })]);
    const input = JSON.parse(first[0].input);
    expect(input).toMatchObject({ type: "html", title: "Sandbox probe" });
    expect(input.content).toContain("typeof parent.document");
    expect(input.content).toContain("fetch('/api/conversations')");
    const done = [user("make a page"), { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "createArtifact", input: {} }] }, { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "createArtifact", output: { type: "text", value: "ok" } }] }];
    expect((await model.doGenerate({ prompt: done })).content[0].type).toBe("text");
  });
});

describe("mock/svg", () => {
  it("creates an SVG artifact with script and an onerror handler in it", async () => {
    const model = mockModelConfig("mock/svg")!.model as any;
    const call = (await model.doGenerate({ prompt: [user("draw")] })).content[0];
    expect(call).toMatchObject({ type: "tool-call", toolName: "createArtifact" });
    const input = JSON.parse(call.input);
    expect(input.type).toBe("svg");
    expect(input.content).toContain("<script>");
    expect(input.content).toContain("onerror");
  });
});
