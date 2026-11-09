import { describe, it, expect } from "vitest";
import { CLI_PROVIDERS } from "@/lib/cliProviders";
import { providerOptionsFor } from "@/lib/chat/providerOptions";

const def = (id: string) => CLI_PROVIDERS.find((d) => d.id === id)!;
const base = { model: "default", system: "", user: "hi" };
const ACCESS = ["chat", "plan", "agent", "ask"] as const;
const claude = (p: object) => def("claude-code").invoke({ ...base, ...p }).args;
const oc = (p: object) => def("opencode").invoke({ ...base, ...p });
const cfg = (p: object) => JSON.parse(oc(p).env!.OPENCODE_CONFIG_CONTENT);
const perm = (p: object) => cfg(p).permission;
/** The values after `--tools`, up to the next flag. */
const toolList = (args: string[]) => {
  const at = args.indexOf("--tools");
  const rest = args.slice(at + 1);
  const end = rest.findIndex((a) => a.startsWith("--"));
  return rest.slice(0, end < 0 ? rest.length : end);
};

describe("web: false gives a workflow CLI card no network", () => {
  it.each(ACCESS)("Claude Code with a folder, %s access: an exact tool allowlist and no user MCP servers", (access) => {
    const args = claude({ cwd: "/work/app", access, web: false });
    expect(args).toContain("--strict-mcp-config");
    expect(args).not.toContain("--disallowedTools"); // an allowlist, not a deny list over `default`
    expect(args.join(" ")).not.toContain("--tools default");
    expect(args.join(" ")).not.toMatch(/WebSearch|WebFetch|Bash|Task/);
    expect(toolList(args)).toEqual(access === "chat" || access === "plan" ? ["Read", "Glob", "Grep"] : ["Read", "Glob", "Grep", "Edit", "Write"]);
    if (access === "agent") expect(args.join(" ")).toContain("--permission-mode acceptEdits");
    if (access === "ask") expect(args.join(" ")).toContain("--permission-mode default --permission-prompt-tool stdio");
  });

  it("Claude Code without a folder is already tool-less and strict", () => {
    const args = claude({ access: "chat", web: false });
    expect(args).toEqual(claude({ access: "chat" }));
    expect(args).toContain("--strict-mcp-config");
  });

  it.each(ACCESS)("Codex, %s access: web search and sandbox network off", (access) => {
    const args = def("codex").invoke({ ...base, cwd: "/work/app", access, web: false }).args.join(" ");
    expect(args).toContain("-c tools.web_search=false");
    expect(args).toContain('-c web_search="disabled"');
    expect(args).toContain("-c sandbox_workspace_write.network_access=false");
  });

  it.each(ACCESS)("OpenCode, %s access: web tools denied, unnamed (MCP) tools denied first, search tools named back in", (access) => {
    const p = perm({ cwd: "/work/app", access, web: false });
    expect(p).toMatchObject({ webfetch: "deny", websearch: "deny", bash: "deny", glob: "allow", grep: "allow", list: "allow" });
    expect(p.read["*"]).toBe("allow");
    expect(Object.keys(p)[0]).toBe("*"); // later rules win, so the catch-all goes first
    expect(p["*"]).toBe("deny");
  });
});

describe("OpenCode rules cannot be undone from the folder or the user's config", () => {
  it.each([true, false])("the same permission sits on the build agent, which is forced (web off: %s)", (off) => {
    const c = cfg({ cwd: "/work/app", access: "chat", ...(off ? { web: false } : {}) });
    expect(c.agent.build.permission).toEqual(c.permission);
    expect(c.agent.build.steps).toBe(50);
    expect(c.permission).toMatchObject({ bash: "deny", external_directory: "deny" });
    expect(c.permission.read["*.env"]).toBe("deny");
    const args = oc({ cwd: "/work/app", access: "chat" }).args;
    expect(args.slice(args.indexOf("--agent"), args.indexOf("--agent") + 2)).toEqual(["--agent", "build"]);
  });
});

describe("chat runs", () => {
  it.each(ACCESS)("%s access: `web: true` and no web option give identical output for every provider", (access) => {
    for (const id of ["claude-code", "codex", "opencode"]) {
      expect(def(id).invoke({ ...base, cwd: "/work/app", access, web: true })).toEqual(def(id).invoke({ ...base, cwd: "/work/app", access }));
    }
  });

  it("Claude Code and Codex chat argv is unchanged", () => {
    expect(claude({ cwd: "/work/app", access: "chat" }).join(" ")).toContain("--tools Read Glob Grep WebSearch WebFetch");
    expect(claude({ cwd: "/work/app", access: "agent" }).join(" ")).toContain("--tools default --permission-mode acceptEdits");
    expect(claude({ cwd: "/work/app", access: "agent" })).not.toContain("--disallowedTools");
    expect(claude({ cwd: "/work/app", access: "chat" })).not.toContain("--strict-mcp-config");
    expect(def("codex").invoke({ ...base, cwd: "/work/app", access: "chat" }).args.join(" ")).not.toMatch(/web_search|network_access/);
  });

  it("OpenCode chat keeps its web tools with a folder and has no catch-all rule", () => {
    expect(perm({ cwd: "/work/app", access: "chat" })).toMatchObject({ webfetch: "allow", websearch: "allow" });
    expect(Object.keys(perm({ cwd: "/work/app", access: "chat" }))).not.toContain("*");
    expect(perm({ access: "chat" })).toMatchObject({ webfetch: "deny", websearch: "deny" });
  });

  it("only a caller that asks passes web: false (the chat route does not)", () => {
    const i = { modelId: "claude-code/default", numCtx: 1, cwd: "/w", access: "chat" as const, conversationId: "", userId: "u", allowedTools: [] };
    expect((providerOptionsFor(i) as any)["claude-code"]).not.toHaveProperty("web");
    expect((providerOptionsFor({ ...i, web: false }) as any)["claude-code"].web).toBe(false);
  });
});
