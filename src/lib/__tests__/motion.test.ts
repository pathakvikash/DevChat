import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { DUR, useMotionOK } from "../motion";

describe("motion", () => {
  it("keeps UI durations within 120-200ms", () => {
    for (const d of Object.values(DUR)) expect(d >= 0.12 && d <= 0.2).toBe(true);
  });
  it("useMotionOK is true without a reduced-motion preference", () => {
    const C = () => createElement("i", null, String(useMotionOK()));
    expect(renderToString(createElement(C))).toContain("true");
  });
});
