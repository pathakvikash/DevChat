import { describe, expect, it } from "vitest";
import { cardMotion } from "@/app/workflows/components/workflowMotion";

describe("cardMotion", () => {
  it("is still when no run is active", () => {
    expect(cardMotion("running", "notrun", "succeeded")).toBe("");
    expect(cardMotion("done", "running", undefined)).toBe("");
  });
  it("pulses running and waiting cards", () => {
    expect(cardMotion("running", undefined, "running")).toBe("wf-run");
    expect(cardMotion("waiting", "running", "waiting")).toBe("wf-wait");
  });
  it("pops or shakes once on a transition, not on first render", () => {
    expect(cardMotion("done", "running", "running")).toBe("wf-pop");
    expect(cardMotion("failed", "running", "running")).toBe("wf-shake");
    expect(cardMotion("done", undefined, "running")).toBe("");
    expect(cardMotion("done", "done", "running")).toBe("");
  });
});
