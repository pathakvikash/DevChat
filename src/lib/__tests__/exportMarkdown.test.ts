import { describe, it, expect } from "vitest";
import { conversationToMarkdown } from "@/lib/exportMarkdown";

const conversation = {
  title: "Cache design",
  model: "gpt-4o",
  createdAt: new Date("2026-10-01T09:00:00Z"),
  compressedAt: null as Date | null,
};

const msg = (role: string, parts: unknown[] | null, content = "", at = "2026-10-01T09:01:00Z") => ({
  role,
  content,
  parts: parts ? JSON.stringify(parts) : null,
  createdAt: new Date(at),
});

const toMarkdown = (
  messages: ReturnType<typeof msg>[],
  artifacts: { id: string; title: string; type: string }[] = [],
  compressedAt: Date | null = null,
) => conversationToMarkdown({ ...conversation, compressedAt, messages }, artifacts);

const patch = (path: string, value: unknown) => ({
  type: "data-spec",
  data: { type: "patch", patch: { op: "add", path, value } },
});

describe("conversationToMarkdown", () => {
  it("writes the header and each message's text", () => {
    const md = toMarkdown([
      msg("user", [{ type: "text", text: "> quoted\n\nwhy?" }]),
      msg("assistant", [{ type: "text", text: "Because." }]),
    ]);
    expect(md).toContain("# Cache design");
    expect(md).toContain("**Model:** gpt-4o");
    expect(md).toContain("**Created:** 2026-10-01T09:00:00.000Z");
    expect(md).toContain("### User\n\n> quoted\n\nwhy?");
    expect(md).toContain("### Assistant\n\nBecause.");
  });

  it("falls back to content when a message has no parts", () => {
    expect(toMarkdown([msg("user", null, "plain text")])).toContain("### User\n\nplain text");
  });

  it("writes a tool call as a one-liner ending in ok", () => {
    const md = toMarkdown([
      msg("assistant", [
        { type: "tool-webSearch", state: "output-available", input: { query: "redis ttl" }, output: "results" },
      ]),
    ]);
    expect(md).toContain('[tool] webSearch {"query":"redis ttl"} → ok');
  });

  it("marks a failed tool call as error", () => {
    const md = toMarkdown([
      msg("assistant", [{ type: "tool-webSearch", state: "output-error", input: { query: "x" }, errorText: "boom" }]),
    ]);
    expect(md).toContain('[tool] webSearch {"query":"x"} → error');
  });

  it("writes one line per call for the shape the chat route really saves", () => {
    // The UI parts and the steps both record each call, under the same toolCallId.
    const saved = [
      { type: "text", text: "Looking it up." },
      { type: "tool-webSearch", toolCallId: "call_1", state: "output-available", input: { query: "redis ttl" }, output: "results" },
      {
        type: "tool-createArtifact",
        toolCallId: "call_2",
        state: "output-available",
        input: { type: "data", title: "Sales by month" },
        output: 'Artifact created: art_1 (v1) — "Sales by month"',
      },
      { type: "tool-webSearch", toolCallId: "call_1", toolName: "webSearch", state: "output-available", input: { query: "redis ttl" }, output: "results" },
      {
        type: "tool-createArtifact",
        toolCallId: "call_2",
        toolName: "createArtifact",
        state: "output-available",
        input: { type: "data", title: "Sales by month" },
        output: 'Artifact created: art_1 (v1) — "Sales by month"',
      },
    ];
    const md = toMarkdown([msg("assistant", saved)], [{ id: "art_1", title: "Sales by month", type: "data" }]);
    expect(md.match(/\[tool\] webSearch/g)).toHaveLength(1);
    expect(md.match(/\[artifact\]/g)).toHaveLength(1);
  });

  it("names an artifact by the title in the artifacts list", () => {
    const md = toMarkdown(
      [
        msg("assistant", [
          {
            type: "tool-createArtifact",
            state: "output-available",
            input: { type: "data", title: "stale title", content: "{}" },
            output: 'Artifact created: art_1 (v2) — "stale title"',
          },
        ]),
      ],
      [{ id: "art_1", title: "Sales by month", type: "data" }],
    );
    expect(md).toContain('[artifact] "Sales by month" (data)');
    expect(md).not.toContain("[tool] createArtifact");
  });

  it("writes a data-spec Chart as [chart] and a Table as [table]", () => {
    const md = toMarkdown([
      msg("assistant", [
        { type: "text", text: "Here you go." },
        patch("/root", "el-0"),
        patch("/elements/el-0", { type: "Stack", props: {}, children: [] }),
        patch("/elements/el-1", { type: "Chart", props: {}, children: [] }),
        patch("/elements/el-2", { type: "Table", props: {}, children: [] }),
      ]),
    ]);
    expect(md).toContain("[chart]");
    expect(md).toContain("[table]");
    expect(md).not.toContain("Stack");
  });

  it("includes messages from before compressedAt and marks where the summary was made", () => {
    const md = toMarkdown(
      [
        msg("user", [{ type: "text", text: "old question" }], "", "2026-10-01T09:05:00Z"),
        msg("assistant", [{ type: "text", text: "old answer" }], "", "2026-10-01T09:06:00Z"),
        msg("user", [{ type: "text", text: "new question" }], "", "2026-10-01T10:30:00Z"),
      ],
      [],
      new Date("2026-10-01T10:00:00Z"),
    );
    expect(md).toContain("old question");
    expect(md).toContain("old answer");
    expect(md).toContain("new question");
    const marker = md.indexOf("Chat compressed here");
    expect(marker).toBeGreaterThan(md.indexOf("old answer"));
    expect(marker).toBeLessThan(md.indexOf("new question"));
  });

  it("puts the summary line last when every message predates it", () => {
    const md = toMarkdown(
      [msg("user", [{ type: "text", text: "only question" }], "", "2026-10-01T09:05:00Z")],
      [],
      new Date("2026-10-01T10:00:00Z"),
    );
    expect(md.indexOf("Chat compressed here")).toBeGreaterThan(md.indexOf("only question"));
  });
});
