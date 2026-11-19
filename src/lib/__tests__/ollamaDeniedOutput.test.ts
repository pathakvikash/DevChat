import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { deniedAsErrorText } from "@/lib/models";

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
