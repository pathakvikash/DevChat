import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Server-renders the message list so every part kind is checked to show up: own tools,
 *  provider-run (dynamic-tool), reasoning, and the empty-bubble live indicator. */
describe("ChatMessages rendering", () => {
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  async function render(messages: unknown[], isLoading: boolean) {
    const { default: ChatMessages } = await import("@/app/components/ChatMessages");
    return renderToStaticMarkup(
      React.createElement(ChatMessages as any, { messages, isLoading, scrollRef: { current: null }, statusLabel: "Waiting for Claude Code (Haiku)…" }),
    );
  }

  it("shows provider-run tools, DevChat tools, reasoning and text", async () => {
    const html = await render(
      [
        { id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "reasoning", text: "Thinking…" },
            { type: "dynamic-tool", toolName: "Read", toolCallId: "toolu_01", state: "output-available", input: { file_path: "notes.txt" }, output: "1\tsecret" },
            { type: "tool-webSearch", toolCallId: "call_1", state: "input-available", input: { query: "bb" } },
            { type: "text", text: "The answer." },
          ],
        },
      ],
      false,
    );
    const t = text(html);
    expect(t).toContain("Tool: Read");
    expect(t).toContain("Tool: webSearch");
    expect(t).toContain("running…");
    expect(t).toContain("Thinking");
    expect(t).toContain("The answer.");
  });

  it("shows a live indicator, not dots, while an assistant bubble is still empty", async () => {
    const html = await render(
      [
        { id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] },
        { id: "a1", role: "assistant", parts: [] },
      ],
      true,
    );
    const t = text(html);
    expect(t).toContain("Thinking…");
    expect(t).not.toMatch(/\s\.\.\.\s/);
  });

  it("keeps the thinking header visible while only reasoning has arrived", async () => {
    const html = await render(
      [
        { id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] },
        { id: "a1", role: "assistant", parts: [{ type: "reasoning", text: "Thinking…" }] },
      ],
      true,
    );
    expect(text(html)).toContain("Thinking");
    // The pulsing dot that says the CLI is still working, not stalled.
    expect(html).toContain('aria-label="working"');
  });

  it("labels the wait before the assistant bubble exists", async () => {
    const html = await render([{ id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] }], true);
    expect(text(html)).toContain("Waiting for Claude Code (Haiku)…");
  });
});
