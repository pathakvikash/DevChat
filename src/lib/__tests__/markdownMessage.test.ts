import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/components/MermaidBlock", () => ({ default: ({ code }: { code: string }) => React.createElement("i", { "data-mermaid": code }) }));
vi.mock("@/app/components/CodeBlock", () => ({ default: ({ code, language }: { code: string; language: string }) => React.createElement("b", { "data-code": language }, code) }));

async function render(content: string, streaming?: boolean) {
  const { default: MarkdownMessage } = await import("@/app/components/MarkdownMessage");
  return renderToStaticMarkup(React.createElement(MarkdownMessage, { content, streaming }));
}

const CLOSED = "```mermaid\nflowchart TD\n  A-->B\n```";
const OPEN = "```mermaid\nflowchart TD\n  A-->";

describe("MarkdownMessage mermaid fences", () => {
  it("draws a closed fence", async () => {
    expect(await render(CLOSED)).toContain("data-mermaid");
    expect(await render(CLOSED, true)).toContain("data-mermaid");
  });
  it("shows a fence still open while streaming as code", async () => {
    const html = await render(OPEN, true);
    expect(html).toContain('data-code="mermaid"');
    expect(html).not.toContain("data-mermaid");
  });
  it("draws that fence once the message is done", async () => {
    expect(await render(OPEN, false)).toContain("data-mermaid");
  });
  it("only holds back the open fence, also inside a list item or quote", async () => {
    const html = await render(`${CLOSED}\n\n- step\n  \`\`\`mermaid\n  graph TD\n    X-->`, true);
    expect(html.match(/data-mermaid/g)).toHaveLength(1);
    expect(html).toContain('data-code="mermaid"');
    const quoted = await render("> ```mermaid\n> graph TD\n>   X-->", true);
    expect(quoted).toContain('data-code="mermaid"');
    expect(quoted).not.toContain("data-mermaid");
  });
  it("leaves other languages alone", async () => {
    expect(await render("```ts\nconst a = 1;\n```", true)).toContain('data-code="ts"');
  });
});
