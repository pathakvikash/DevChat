import { describe, expect, it } from "vitest";
import { fenceText } from "@/lib/chat/quotePastChat";

describe("fenceText", () => {
  it("fences past the longest backtick run", () => {
    expect(fenceText("a ```` b").startsWith("`````\n")).toBe(true);
  });

  it("handles a huge number of backtick runs without overflowing the stack", () => {
    const body = "` ".repeat(200_000);
    expect(() => fenceText(body)).not.toThrow();
  });
});
