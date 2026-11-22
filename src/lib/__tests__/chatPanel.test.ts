import { describe, expect, it } from "vitest";
import { panelHref, parsePanel } from "../chatPanel";
import { parsePanes, serializePanes } from "../splitPanes";

const q = (s: string) => new URLSearchParams(s);

describe("parsePanel", () => {
  it("reads view, item and owner", () => {
    expect(parsePanel(q("panel=outputs&item=abc"), ["a"])).toEqual({ view: "outputs", item: "abc", owner: "a" });
  });
  it("owner is the first pane unless panelOf names an open chat", () => {
    expect(parsePanel(q("panel=tasks&panelOf=b"), ["a", "b"])?.owner).toBe("b");
    expect(parsePanel(q("panel=tasks&panelOf=zzz"), ["a", "b"])?.owner).toBe("a");
  });
  it("rejects unknown views, bad item ids and no chats", () => {
    expect(parsePanel(q("panel=browser"), ["a"])).toBeNull();
    expect(parsePanel(q(""), ["a"])).toBeNull();
    expect(parsePanel(q("panel=files"), [])).toBeNull();
    expect(parsePanel(q("panel=files&item=../etc/passwd"), ["a"])?.item).toBeNull();
  });
});

describe("panelHref", () => {
  it("keeps other params and omits panelOf for the first pane", () => {
    expect(panelHref("/c/a", q("split=b&focus=b"), { view: "context", owner: "a" })).toBe("/c/a?split=b&focus=b&panel=context");
  });
  it("writes panelOf for another pane, and item", () => {
    expect(panelHref("/c/a", q("split=b"), { view: "outputs", item: "x1", owner: "b" })).toBe("/c/a?split=b&panel=outputs&item=x1&panelOf=b");
  });
  it("replaces an open panel and closes it with null", () => {
    expect(panelHref("/c/a", q("panel=files&item=old&panelOf=b"), { view: "notes", owner: "a" })).toBe("/c/a?panel=notes");
    expect(panelHref("/c/a", q("split=b&panel=files"), null)).toBe("/c/a?split=b");
    expect(panelHref("/c/a", q("panel=files"), null)).toBe("/c/a");
  });
  it("survives split serialisation, which keeps unknown params", () => {
    const href = serializePanes(["a", "b"], "b", q("panel=outputs&item=x1&panelOf=b"));
    const params = new URL(href, "http://x").searchParams;
    expect(parsePanes("/c/a", params)).toEqual({ ids: ["a", "b"], focus: "b" });
    expect(params.get("panel")).toBe("outputs");
    expect(params.get("panelOf")).toBe("b");
  });
});
