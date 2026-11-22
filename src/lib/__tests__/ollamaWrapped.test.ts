import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { initializeOllamaModels, getModel } from "@/lib/models";

afterEach(() => vi.unstubAllGlobals());

describe("the Ollama model is wrapped", () => {
  it("sends a denied tool result as its reason, and num_ctx under options", async () => {
    const chatBodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "llama3:latest" }] }));
        if (u.includes("/api/show")) return new Response("{}");
        chatBodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({ model: "llama3", created_at: new Date().toISOString(), message: { role: "assistant", content: "ok" }, done: true, done_reason: "stop" }),
          { headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    await initializeOllamaModels();
    const { model } = getModel("ollama/llama3:latest");
    await (model as any).doGenerate({
      prompt: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "Bash", input: {} }] },
        { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "Bash", output: { type: "execution-denied", reason: "Not now" } }] },
      ],
      providerOptions: { ollama: { options: { num_ctx: 32768 } } },
    });
    expect(chatBodies).toHaveLength(1);
    const tool = chatBodies[0].messages.find((m: any) => m.role === "tool");
    expect(tool.content).toContain("Not now");
    expect(chatBodies[0].options.num_ctx).toBe(32768);
  });
});
