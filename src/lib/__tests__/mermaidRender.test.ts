import { describe, expect, it } from "vitest";
import { diagramLabel, errorSummary, openFenceBody, sameFence, withFreshIds } from "../mermaidRender";

describe("openFenceBody", () => {
  it("is null when every fence is closed", () => {
    expect(openFenceBody("a\n```mermaid\nA-->B\n```\nb")).toBeNull();
    expect(openFenceBody("no fences")).toBeNull();
  });
  it("returns the body of a fence still open", () => {
    expect(openFenceBody("```mermaid\nflowchart TD\n  A-->")).toBe("flowchart TD\n  A-->");
    expect(openFenceBody("```ts\nx\n```\n```mermaid\nA-->B\n")).toBe("A-->B");
  });
  it("needs a closing fence at least as long, of the same kind", () => {
    expect(openFenceBody("````md\n```\ninner\n```")).toBe("```\ninner\n```");
  });
  it("sees fences inside list items and quotes", () => {
    expect(openFenceBody("- step\n  ```mermaid\n  A-->")).toBe("  A-->");
    expect(openFenceBody("10. step\n    ```mermaid\n    A-->B")).toBe("    A-->B");
    expect(openFenceBody("> ```mermaid\n> A-->")).toBe("> A-->");
    expect(openFenceBody("> ```mermaid\n> A-->B\n> ```")).toBeNull();
    expect(openFenceBody("- s\n  ```mermaid\n  A-->B\n  ```")).toBeNull();
  });
});

describe("sameFence", () => {
  it("ignores indent and quote marks", () => {
    expect(sameFence("A-->\nB", "  A-->\n  B")).toBe(true);
    expect(sameFence("A-->\nB", "> A-->\n> B")).toBe(true);
    expect(sameFence("A-->B", "A-->C")).toBe(false);
    expect(sameFence("A", null)).toBe(false);
  });
});

describe("withFreshIds", () => {
  const entry = {
    id: "mermaid-7",
    svg: '<svg id="mermaid-7"><marker id="mermaid-7_flowchart-v2-pointEnd"/><path marker-end="url(#mermaid-7_flowchart-v2-pointEnd)"/><g id="mermaid-70"/></svg>',
  };
  it("gives every read its own ids, so copies on one page do not collide", () => {
    const a = withFreshIds(entry);
    expect(a).not.toBe(withFreshIds(entry));
    expect(a).not.toContain('id="mermaid-7"');
    const id = /<svg id="(mermaid-\d+)"/.exec(a)![1];
    expect(a).toContain(`url(#${id}_flowchart-v2-pointEnd)`);
    expect(a).toContain('id="mermaid-70"'); // an id that only starts with the same digits is left alone
  });
});

describe("diagramLabel", () => {
  it("names the diagram type", () => {
    expect(diagramLabel("flowchart TD\n A-->B")).toBe("Flowchart diagram");
    expect(diagramLabel("%%{init: {}}%%\nsequenceDiagram\n A->>B: hi")).toBe("Sequence diagram");
    expect(diagramLabel("weird")).toBe("Mermaid diagram");
  });
});

describe("errorSummary", () => {
  it("keeps the parse error line and the expecting line, without the caret art", () => {
    const e = new Error("Parse error on line 3:\n...A[Start] -->\n-----------------^\nExpecting 'NODE_STRING', got 'EOF'");
    expect(errorSummary(e)).toBe("Parse error on line 3: Expecting 'NODE_STRING', got 'EOF'");
  });
  it("falls back to the first line", () => {
    expect(errorSummary(new Error("\nSomething broke\nmore"))).toBe("Something broke");
  });
});
