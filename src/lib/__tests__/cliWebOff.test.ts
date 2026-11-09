import { describe, it, expect } from "vitest";
import { CLI_PROVIDERS } from "@/lib/cliProviders";
import { providerOptionsFor } from "@/lib/chat/providerOptions";

const def = (id: string) => CLI_PROVIDERS.find((d) => d.id === id)!;
const base = { model: "default", system: "", user: "hi", cwd: "/work/app" };

describe("web: false switches off a CLI's own web tools", () => {
  it("Claude Code, read-only: no WebSearch or WebFetch in --tools; by default they are there", () => {
    const off = def("claude-code").invoke({ ...base, access: "chat", web: false }).args;
    expect(off.slice(off.indexOf("--tools"), off.indexOf("--tools") + 4)).toEqual(["--tools", "Read", "Glob", "Grep"]);
    expect(off.join(" ")).not.toMatch(/WebSearch|WebFetch/);
    expect(def("claude-code").invoke({ ...base, access: "chat" }).args.join(" ")).toContain("WebSearch WebFetch");
  });

  it("Claude Code, agent access and Ask: disallows both web tools", () => {
    for (const access of ["agent", "ask"] as const) {
      const args = def("claude-code").invoke({ ...base, access, web: false }).args;
      const at = args.indexOf("--disallowedTools");
      expect(args.slice(at, at + 3)).toEqual(["--disallowedTools", "WebFetch", "WebSearch"]);
    }
    expect(def("claude-code").invoke({ ...base, access: "agent" }).args).not.toContain("--disallowedTools");
  });

  it("OpenCode: webfetch and websearch are denied even with a folder", () => {
    const perm = (web?: boolean) => JSON.parse(def("opencode").invoke({ ...base, access: "chat", web }).env!.OPENCODE_CONFIG_CONTENT).permission;
    expect(perm(false)).toMatchObject({ webfetch: "deny", websearch: "deny" });
    expect(perm()).toMatchObject({ webfetch: "allow", websearch: "allow" });
  });

  it("Codex: web search is configured off", () => {
    expect(def("codex").invoke({ ...base, access: "chat", web: false }).args.join(" ")).toContain("-c tools.web_search=false");
    expect(def("codex").invoke({ ...base, access: "chat" }).args.join(" ")).not.toContain("web_search");
  });

  it("only a caller that asks passes web: false (the chat route does not)", () => {
    const i = { modelId: "claude-code/default", numCtx: 1, cwd: "/w", access: "chat" as const, conversationId: "", userId: "u", allowedTools: [] };
    expect((providerOptionsFor(i) as any)["claude-code"]).not.toHaveProperty("web");
    expect((providerOptionsFor({ ...i, web: false }) as any)["claude-code"].web).toBe(false);
  });
});
