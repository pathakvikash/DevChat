import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { getStreaming, setStreaming, useIsStreaming } from "../streamingState";

describe("streamingState", () => {
  it("stores the flag and renders false on the server", () => {
    const C = () => createElement("i", null, String(useIsStreaming()));
    setStreaming(true);
    expect(getStreaming()).toBe(true);
    expect(renderToString(createElement(C))).toContain("false");
    setStreaming(false);
    expect(getStreaming()).toBe(false);
  });
});
