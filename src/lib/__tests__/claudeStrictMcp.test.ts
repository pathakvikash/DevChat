import { describe, it, expect } from "vitest";
import { CLI_PROVIDERS, withStrictMcp } from "@/lib/cliProviders";

const claude = CLI_PROVIDERS.find((d) => d.id === "claude-code")!;
const base = { model: "sonnet", system: "s", user: "u" };
const cases = [
  { cwd: undefined, access: "chat" as const },
  { cwd: "/p", access: "chat" as const },
  { cwd: "/p", access: "plan" as const },
  { cwd: "/p", access: "agent" as const },
  { cwd: "/p", access: "ask" as const },
  { cwd: "/p", access: "agent" as const, web: false },
];

describe("noCommands (bridge only) gives Agent mode no command tools", () => {
  const TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "MultiEdit", "NotebookEdit", "WebSearch", "WebFetch"];
  it("leaves every server-path argv unchanged when absent or false", () => {
    for (const c of cases) {
      const plain = claude.invoke({ ...base, ...c }).args;
      expect(claude.invoke({ ...base, ...c, noCommands: undefined }).args).toEqual(plain);
      expect(claude.invoke({ ...base, ...c, noCommands: false }).args).toEqual(plain);
    }
  });
  it("changes only Agent mode with a folder: an explicit tool list, command tools denied, still acceptEdits", () => {
    for (const c of cases) {
      const plain = claude.invoke({ ...base, ...c }).args;
      const nc = claude.invoke({ ...base, ...c, noCommands: true }).args;
      if (c.cwd && c.access === "agent" && !("web" in c)) {
        expect(nc.join(" ")).not.toContain("--tools default");
        expect(nc.slice(nc.indexOf("--tools") + 1, nc.indexOf("--tools") + 10)).toEqual(TOOLS);
        expect(nc.slice(nc.indexOf("--disallowedTools") + 1, nc.indexOf("--disallowedTools") + 5)).toEqual(["Bash", "Monitor", "PowerShell", "Tmux"]);
        expect(nc).toContain("acceptEdits");
      } else if (!(c.cwd && c.access === "agent")) expect(nc).toEqual(plain);
    }
  });
});

describe("--strict-mcp-config is opt-in (only the local bridge sets it)", () => {
  it("leaves the server path's argv byte for byte unchanged", () => {
    for (const c of cases) {
      const plain = claude.invoke({ ...base, ...c }).args;
      expect(claude.invoke({ ...base, ...c, strictMcp: undefined }).args).toEqual(plain);
      expect(claude.invoke({ ...base, ...c, strictMcp: false }).args).toEqual(plain);
    }
  });
  it("adds the flag once when asked, and never twice", () => {
    for (const c of cases) {
      const plain = claude.invoke({ ...base, ...c }).args;
      const strict = claude.invoke({ ...base, ...c, strictMcp: true }).args;
      expect(strict.filter((a) => a === "--strict-mcp-config")).toHaveLength(1);
      expect(strict.filter((a) => a !== "--strict-mcp-config")).toEqual(plain.filter((a) => a !== "--strict-mcp-config"));
    }
    expect(withStrictMcp(["--tools", ""], true)).toEqual(["--tools", "", "--strict-mcp-config"]);
  });
});
