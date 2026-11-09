import { describe, it, expect } from "vitest";
import { CLI_PROVIDERS } from "@/lib/cliProviders";
import { providerOptionsFor } from "@/lib/chat/providerOptions";

const def = (id: string) => CLI_PROVIDERS.find((d) => d.id === id)!;
const base = { model: "default", system: "", user: "hi" };
const ACCESS = ["chat", "plan", "agent", "ask"] as const;
const claude = (p: object) => def("claude-code").invoke({ ...base, ...p }).args;
const perm = (p: object) => JSON.parse(def("opencode").invoke({ ...base, ...p }).env!.OPENCODE_CONFIG_CONTENT).permission;

describe("web: false gives a workflow CLI card no network", () => {
  it.each(ACCESS)("Claude Code with a folder, %s access: web tools and Bash denied, user MCP servers not loaded", (access) => {
    const args = claude({ cwd: "/work/app", access, web: false });
    expect(args).toContain("--strict-mcp-config");
    if (access === "chat" || access === "plan") {
      // read-only: only Read, Glob and Grep exist
      expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 4)).toEqual(["--tools", "Read", "Glob", "Grep"]);
      expect(args.join(" ")).not.toMatch(/WebSearch|WebFetch|Bash/);
    } else {
      const at = args.indexOf("--disallowedTools");
      expect(args.slice(at, at + 4)).toEqual(["--disallowedTools", "WebFetch", "WebSearch", "Bash"]);
    }
  });

  it("Claude Code without a folder is already tool-less and strict", () => {
    const args = claude({ access: "chat", web: false });
    expect(args).toEqual(claude({ access: "chat" }));
    expect(args).toContain("--strict-mcp-config");
  });

  it.each(ACCESS)("Codex, %s access: web search and sandbox network off", (access) => {
    const args = def("codex").invoke({ ...base, cwd: "/work/app", access, web: false }).args.join(" ");
    expect(args).toContain("-c tools.web_search=false");
    expect(args).toContain("-c sandbox_workspace_write.network_access=false");
  });

  it.each(ACCESS)("OpenCode, %s access: web tools denied and every unnamed tool (MCP) denied first", (access) => {
    const p = perm({ cwd: "/work/app", access, web: false });
    expect(p).toMatchObject({ webfetch: "deny", websearch: "deny", bash: "deny" });
    expect(Object.keys(p)[0]).toBe("*"); // later rules win, so the catch-all goes first
    expect(p["*"]).toBe("deny");
  });
});

describe("chat runs are unchanged", () => {
  it.each(ACCESS)("%s access: no web option and `web: true` give identical args", (access) => {
    for (const id of ["claude-code", "codex", "opencode"]) {
      const a = def(id).invoke({ ...base, cwd: "/work/app", access });
      const b = def(id).invoke({ ...base, cwd: "/work/app", access, web: true });
      expect(b).toEqual(a);
    }
  });

  it("the read-only Claude Code and OpenCode chat sets keep their web tools", () => {
    expect(claude({ cwd: "/work/app", access: "chat" }).join(" ")).toContain("Read Glob Grep WebSearch WebFetch");
    expect(claude({ cwd: "/work/app", access: "agent" })).not.toContain("--disallowedTools");
    expect(claude({ cwd: "/work/app", access: "chat" })).not.toContain("--strict-mcp-config");
    expect(perm({ cwd: "/work/app", access: "chat" })).toMatchObject({ webfetch: "allow", websearch: "allow" });
    expect(Object.keys(perm({ cwd: "/work/app", access: "chat" }))).not.toContain("*");
    expect(def("codex").invoke({ ...base, cwd: "/work/app", access: "chat" }).args.join(" ")).not.toMatch(/web_search|network_access/);
  });

  it("only a caller that asks passes web: false (the chat route does not)", () => {
    const i = { modelId: "claude-code/default", numCtx: 1, cwd: "/w", access: "chat" as const, conversationId: "", userId: "u", allowedTools: [] };
    expect((providerOptionsFor(i) as any)["claude-code"]).not.toHaveProperty("web");
    expect((providerOptionsFor({ ...i, web: false }) as any)["claude-code"].web).toBe(false);
  });
});
