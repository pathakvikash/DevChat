import { describe, it, expect } from "vitest";
import { CLI_PROVIDERS } from "@/lib/cliProviders";
import { CLI_PROVIDER_IDS } from "@/lib/providers";

const claude = CLI_PROVIDERS.find((d) => d.id === "claude-code")!;

/** Every cwd x access x offline combination, as the tool and permission flags Claude Code gets. */
const FLAGS: Record<string, string[]> = {
  "no folder | chat": ["--tools", "", "--strict-mcp-config", "--permission-mode", "manual"],
  "no folder | plan": ["--tools", "", "--strict-mcp-config", "--permission-mode", "plan"],
  "no folder | ask": ["--tools", "", "--strict-mcp-config", "--permission-mode", "manual"],
  "no folder | agent": ["--tools", "", "--strict-mcp-config", "--permission-mode", "manual"],
  "folder | chat": ["--tools", "Read", "Glob", "Grep", "WebSearch", "WebFetch", "--permission-mode", "manual"],
  "folder | plan": ["--tools", "Read", "Glob", "Grep", "WebSearch", "WebFetch", "--permission-mode", "plan"],
  "folder | ask": ["--tools", "default", "--permission-mode", "default", "--permission-prompt-tool", "stdio"],
  "folder | agent": ["--tools", "default", "--permission-mode", "acceptEdits"],
  "folder offline | chat": ["--tools", "Read", "Glob", "Grep", "--strict-mcp-config", "--permission-mode", "manual"],
  "folder offline | plan": ["--tools", "Read", "Glob", "Grep", "--strict-mcp-config", "--permission-mode", "plan"],
  "folder offline | ask": ["--tools", "Read", "Glob", "Grep", "Edit", "Write", "--strict-mcp-config", "--permission-mode", "default", "--permission-prompt-tool", "stdio"],
  "folder offline | agent": ["--tools", "Read", "Glob", "Grep", "Edit", "Write", "--strict-mcp-config", "--permission-mode", "acceptEdits"],
};

describe("Claude Code tool and permission flags", () => {
  for (const [name, expected] of Object.entries(FLAGS)) {
    it(name, () => {
      const [where, access] = name.split(" | ");
      const { args } = claude.invoke({
        model: "default",
        system: "",
        user: "hi",
        cwd: where.startsWith("folder") ? "/work" : "",
        access: access as any,
        web: where.includes("offline") ? false : undefined,
      } as any) as { args: string[] };
      // The flags sit between the fixed head and the --system-prompt/--model/--effort tail.
      const start = args.indexOf("--disable-slash-commands") + 1;
      const head = args.slice(start);
      const flags = head[0] === "--permission-prompts" ? head.slice(2) : head;
      expect(flags).toEqual(expected);
    });
  }
});

describe("CLI_PROVIDER_IDS", () => {
  it("matches the ids in CLI_PROVIDERS", () => {
    expect([...CLI_PROVIDER_IDS].sort()).toEqual(CLI_PROVIDERS.map((d) => d.id).sort());
  });
});
