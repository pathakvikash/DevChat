import { describe, it, expect, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { ModelConfig } from "@/lib/models";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(), UnauthorizedError: class extends Error {} }));
vi.mock("@/lib/llm", () => ({ resolveModel: vi.fn() }));
vi.mock("@/lib/hostAccess", () => ({ canUseHostTools: vi.fn(), HOST_TOOLS_REFUSED: "owner only" }));
vi.mock("@/lib/settings", () => ({ getSettingsKey: vi.fn(async () => "") }));
vi.mock("@/lib/db", () => ({ prisma: { workflow: { findFirst: vi.fn() } } }));

import { catalogForPrompt, generateFlow } from "@/lib/workflows/generate";

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
function scripted(reply: unknown) {
  const calls: { prompt: any[] }[] = [];
  const mock = new MockLanguageModelV3({
    provider: "mock",
    modelId: "mock/gen",
    doGenerate: async (o: any) => {
      calls.push({ prompt: o.prompt });
      return { content: [{ type: "text", text: `\`\`\`json\n${JSON.stringify(reply)}\n\`\`\`` }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] } as any;
    },
  });
  return { model: { id: "mock/gen", name: "gen", provider: "Mock", model: mock, contextWindow: 32_000, supportsTools: false } as unknown as ModelConfig, calls };
}
const node = (id: string, type: string, fromIds: string[], config: Record<string, unknown> = {}) => ({ id, type, fromIds, config, label: id });

describe("generated flows with table cards", () => {
  it("the model cannot make up a table id: a new Save card has none and gets a 'pick a table' issue", async () => {
    const reply = {
      vars: [],
      nodes: [
        node("trigger", "trigger", []),
        node("news", "webSearch", ["trigger"], { queries: "x" }),
        node("save", "table", ["news"], { tableId: "cmFAKEid123", list: "{{news.items}}" }),
      ],
    };
    const { graph, warnings } = await generateFlow({ description: "save news", model: scripted(reply).model });
    expect(graph.nodes.find((n) => n.id === "save")!.config.tableId).toBe("");
    expect(warnings).toContain("save: pick a table");
  });

  it("on a change the same Save card keeps its table, even when the reply names another, and the model is never shown it", async () => {
    const current = {
      version: 1 as const,
      defaultModel: "mock/gen",
      maxRunTokens: 500_000,
      vars: [],
      nodes: [
        { id: "trigger", type: "trigger" as const, fromIds: [], config: {}, ui: { label: "Run", position: { x: 0, y: 0 } } },
        { id: "news", type: "webSearch" as const, fromIds: ["trigger"], config: { queries: "x" }, ui: { label: "News", position: { x: 1, y: 0 } } },
        { id: "save", type: "table" as const, fromIds: ["news"], config: { tableId: "my-real-table", list: "{{news.items}}" }, ui: { label: "Save", position: { x: 2, y: 0 } } },
      ],
    };
    const reply = {
      vars: [],
      nodes: [node("trigger", "trigger", []), node("news", "webSearch", ["trigger"], { queries: "y" }), node("save", "table", ["news"], { tableId: "other-table", list: "{{news.items}}", keyField: "link" })],
    };
    const s = scripted(reply);
    const { graph, warnings } = await generateFlow({ description: "change the query", model: s.model, current });
    const save = graph.nodes.find((n) => n.id === "save")!;
    expect(save.config.tableId).toBe("my-real-table");
    expect(save.config.keyField).toBe("link");
    expect(JSON.stringify(s.calls[0].prompt)).not.toContain("my-real-table");
    expect(warnings.some((w) => w.includes("pick a table"))).toBe(false);
    expect(warnings.some((w) => w.includes("tableId"))).toBe(false);
  });

  it("the catalog text explains the shapes of rules and columns, and leaves out the table picker", () => {
    const text = catalogForPrompt();
    expect(text).toContain('rules: list of { "field": "{{item.score}}", "op": one of "eq"');
    expect(text).toContain('fields: list of { "column": "column name", "value": "{{item.title}}" }');
    expect(text).toContain("filter");
    expect(text).not.toMatch(/tableId:/);
  });
});
