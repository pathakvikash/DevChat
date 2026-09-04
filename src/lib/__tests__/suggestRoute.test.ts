import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockLanguageModelV3 } from "ai/test";

/** The suggest endpoint must return `{ suggestion: null }` for anything unusable, never
 *  a broken string or 500 — the client shows whatever it gets as the placeholder. */

const h = vi.hoisted(() => ({
  requireUserId: vi.fn(),
  getConversationOrNull: vi.fn(),
  resolveModel: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUserId: h.requireUserId }));
vi.mock("@/lib/api/conversations", () => ({ getConversationOrNull: h.getConversationOrNull }));
vi.mock("@/lib/llm", () => ({ resolveModel: h.resolveModel }));

const { POST } = await import("@/app/api/conversations/[id]/suggest/route");

/** A model that answers with `text`, or throws if given an Error. */
function replyWith(text: string | Error) {
  return {
    model: new MockLanguageModelV3({
      doGenerate: async () => {
        if (text instanceof Error) throw text;
        return {
          content: text ? [{ type: "text", text }] : [],
          finishReason: { unified: "stop" },
          usage: { inputTokens: {}, outputTokens: {} },
          warnings: [],
        } as any;
      },
    }),
  };
}

async function post(body: unknown) {
  const res = await POST({ json: async () => body } as any, { params: Promise.resolve({ id: "c1" }) });
  return { status: res.status, body: await res.json() };
}

describe("POST /api/conversations/[id]/suggest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireUserId.mockResolvedValue("u1");
    h.getConversationOrNull.mockResolvedValue({ id: "c1", model: "openai/gpt-4o-mini" });
  });

  const exchange = { user: "how do I run the tests?", assistant: "Run `npx vitest run`." };

  it("returns the model's one-line suggestion", async () => {
    h.resolveModel.mockResolvedValue(replyWith("Show me the failing test"));
    const res = await post(exchange);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ suggestion: "Show me the failing test" });
  });

  it("strips quotes, markdown and list markers from the model's answer", async () => {
    h.resolveModel.mockResolvedValue(replyWith('- **"Show me the failing test."**\nsecond line'));
    expect((await post(exchange)).body).toEqual({ suggestion: "Show me the failing test" });
  });

  it("returns null when the model says NONE", async () => {
    h.resolveModel.mockResolvedValue(replyWith("NONE"));
    expect((await post(exchange)).body).toEqual({ suggestion: null });
  });

  it("returns null for an over-long answer", async () => {
    h.resolveModel.mockResolvedValue(replyWith("x".repeat(200)));
    expect((await post(exchange)).body).toEqual({ suggestion: null });
  });

  it("returns null without calling the model when the assistant text is empty", async () => {
    h.resolveModel.mockResolvedValue(replyWith("Show me the failing test"));
    expect((await post({ user: "hi", assistant: "" })).body).toEqual({ suggestion: null });
    expect(h.resolveModel).not.toHaveBeenCalled();
  });

  it("returns null instead of throwing when the model fails", async () => {
    h.resolveModel.mockResolvedValue(replyWith(new Error("CLI not on PATH")));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await post(exchange)).body).toEqual({ suggestion: null });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("404s when the conversation is not the caller's", async () => {
    h.getConversationOrNull.mockResolvedValue(null);
    expect((await post(exchange)).status).toBe(404);
  });
});
