import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { getStreaming, setPaneStreaming, useIsStreaming } from "../streamingState";

describe("streamingState", () => {
  it("renders false on the server", () => {
    const C = () => createElement("i", null, String(useIsStreaming()));
    const a = { current: false };
    setPaneStreaming(a, true);
    expect(getStreaming()).toBe(true);
    expect(renderToString(createElement(C))).toContain("false");
    setPaneStreaming(a, false);
    expect(getStreaming()).toBe(false);
  });

  it("stays on until every streaming pane has stopped, and never double-decrements", () => {
    const a = { current: false };
    const b = { current: false };
    setPaneStreaming(a, true);
    setPaneStreaming(b, true);
    setPaneStreaming(a, true);
    setPaneStreaming(a, false);
    setPaneStreaming(a, false);
    expect(getStreaming()).toBe(true);
    setPaneStreaming(b, false);
    expect(getStreaming()).toBe(false);
  });
});
