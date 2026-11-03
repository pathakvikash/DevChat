import { describe, it, expect } from "vitest";
import { formatAgo, sideChatTitle, toolLineLabel, toolSummary } from "@/lib/chat/sideChatLabels";

describe("side chat labels", () => {
  it("uses the title, then the first message, then the default", () => {
    expect(sideChatTitle("Pricing check", "ignored")).toBe("Pricing check");
    expect(sideChatTitle("  ", "what   is\n2+2")).toBe("what is 2+2");
    expect(sideChatTitle(null, undefined)).toBe("Side chat");
    expect(sideChatTitle("New Chat", "ping from main")).toBe("ping from main");
  });

  it("folds a tool call to a one-line label with its input summary", () => {
    expect(toolLineLabel("searchChats", { query: "react hooks" })).toBe("Used Search chats: react hooks");
    expect(toolLineLabel("executeCode", { code: "print(1)" })).toBe("Used Execute code");
    // OpenCode's own tools: a task is named by its description, a grep by its pattern, a read by its file.
    expect(toolLineLabel("task", { description: "Reply with hi", prompt: "Say hi" })).toBe("Used Task: Reply with hi");
    expect(toolLineLabel("grep", { pattern: "TODO", path: "/repo" })).toBe("Used Grep: TODO");
    expect(toolLineLabel("read", { filePath: "/repo/a.ts" })).toBe("Used Read: /repo/a.ts");
    // Not its description: a Bash call is named by the command, a todo by its title.
    expect(toolLineLabel("Bash", { command: "npm test", description: "Run the tests" })).toBe("Used Bash: npm test");
    expect(toolLineLabel("createTodo", { title: "Ship it", description: "later" })).toBe("Used Create todo: Ship it");
    // A bidi mark in a file name is written out, not left to reorder the line.
    expect(toolLineLabel("read", { filePath: "/repo/\u202Etxt.exe" })).toBe("Used Read: /repo/\\u202Etxt.exe");
    expect(toolSummary({ filePath: "a".repeat(400) }, 300)).toHaveLength(300);
  });

  it("says how long ago a message was", () => {
    const now = Date.parse("2026-10-30T12:00:00Z");
    expect(formatAgo(new Date(now - 19 * 3_600_000), now)).toBe("19 hours ago");
    expect(formatAgo(new Date(now - 30_000), now)).toBe("just now");
    expect(formatAgo(new Date(now - 86_400_000), now)).toBe("1 day ago");
    expect(formatAgo("not a date", now)).toBe("");
  });
});
