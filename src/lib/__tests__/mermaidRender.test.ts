import { describe, expect, it } from "vitest";
import { diagramLabel, firstErrorLine, openFenceBody } from "../mermaidRender";

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
});

describe("diagramLabel", () => {
  it("names the diagram type", () => {
    expect(diagramLabel("flowchart TD\n A-->B")).toBe("Flowchart diagram");
    expect(diagramLabel("%%{init: {}}%%\nsequenceDiagram\n A->>B: hi")).toBe("Sequence diagram");
    expect(diagramLabel("weird")).toBe("Mermaid diagram");
  });
});

describe("firstErrorLine", () => {
  it("keeps the first non-empty line", () => {
    expect(firstErrorLine(new Error("\nParse error on line 2:\n...^"))).toBe("Parse error on line 2:");
  });
});
