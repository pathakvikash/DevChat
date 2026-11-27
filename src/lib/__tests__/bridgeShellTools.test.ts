import { describe, it, expect } from "vitest";
import { needsTerminalConfirm, NO_CODE_TOOLS } from "@/lib/bridge/shellTools";

describe("needsTerminalConfirm: everything except a short allowlist", () => {
  it("lets only the tools known not to run code through", () => {
    for (const t of ["Read", "Glob", "Grep", "Edit", "Write", "MultiEdit", "NotebookEdit", "WebSearch", "WebFetch", "TodoWrite"]) expect(needsTerminalConfirm(t)).toBe(false);
    expect(NO_CODE_TOOLS).toHaveLength(10);
  });
  it("confirms command tools, Monitor and Tmux, MCP tools and anything unknown", () => {
    for (const t of ["Bash", "BashOutput", "PowerShell", "Monitor", "Tmux", "Task", "mcp__github__create_issue", "SomethingNew", "bash", ""]) expect(needsTerminalConfirm(t)).toBe(true);
  });
});
