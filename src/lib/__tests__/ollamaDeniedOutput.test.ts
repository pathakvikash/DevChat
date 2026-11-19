import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { deniedAsErrorText, withDefaultNumCtx } from "@/lib/models";

describe("withDefaultNumCtx", () => {
  it("adds the capped default when no num_ctx is set, keeping other options", () => {
    const out = withDefaultNumCtx({ providerOptions: { ollama: { options: { temperature: 0.3 } } } }, 131072);
    expect(out.providerOptions.ollama.options).toEqual({ temperature: 0.3, num_ctx: 8192 });
    expect(withDefaultNumCtx<{ providerOptions?: any }>({}, 4096).providerOptions.ollama.options.num_ctx).toBe(4096);
  });

  it("leaves a num_ctx that is already set alone", () => {
    const params = { providerOptions: { ollama: { options: { num_ctx: 32768 } } } };
    expect(withDefaultNumCtx(params, 131072)).toBe(params);
  });
});

const tool = (output: any) => ({ role: "tool", content: [{ type: "tool-result", toolCallId: "1", toolName: "x", output }] });

describe("deniedAsErrorText", () => {
  it("turns a denial with a reason into error-text carrying it", () => {
    const [m] = deniedAsErrorText([tool({ type: "execution-denied", reason: "Not now" })]);
    expect(m.content[0].output).toEqual({ type: "error-text", value: "Not now" });
  });

  it("falls back when there is no reason", () => {
    const [m] = deniedAsErrorText([tool({ type: "execution-denied" })]);
    expect(m.content[0].output).toEqual({ type: "error-text", value: "Tool call execution denied." });
  });

  it("leaves other outputs and non-tool messages alone", () => {
    const prompt = [{ role: "user", content: [{ type: "text", text: "hi" }] }, tool({ type: "text", value: "ok" }), tool({ type: "json", value: {} })];
    expect(deniedAsErrorText(prompt)).toEqual(prompt);
  });
});
