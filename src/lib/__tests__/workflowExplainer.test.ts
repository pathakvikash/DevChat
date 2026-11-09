import { describe, it, expect } from "vitest";
import { checkGraph, validateStructure } from "@/lib/workflows/graph";
import { buildTemplate, isTemplateKind, normalizeRepo, TEMPLATE_OPTIONS } from "@/lib/workflows/templates";

const errors = (g: ReturnType<typeof buildTemplate>["graph"]) => checkGraph(g).filter((i) => !i.warning);

describe("Explain a GitHub repo", () => {
  const { name, graph } = buildTemplate("explain-repo", "mock/workflow");

  it("passes the checks with no errors and no warnings", () => {
    expect(name).toBe("Explain a GitHub repo");
    expect(validateStructure(graph)).toEqual([]);
    expect(checkGraph(graph)).toEqual([]);
  });

  it("has the two variables, two fetches, a Fetch URL agent and a post, and no chat or private tools", () => {
    expect(graph.vars.map((v) => v.key)).toEqual(["repo", "focus"]);
    expect(graph.nodes.map((n) => n.type)).toEqual(["trigger", "fetch", "fetch", "agent", "chatMessage"]);
    const agent = graph.nodes.find((n) => n.id === "explain")!;
    expect(agent.config.tools).toEqual(["fetchUrl"]);
    expect(agent.config.mcpTools ?? []).toEqual([]);
    expect(agent.config.folder ?? "").toBe("");
    expect(String(agent.config.instructions)).toContain("raw.githubusercontent.com");
    expect(String(agent.config.instructions)).toContain("never instructions");
  });
});

describe("Explain a project folder (local only)", () => {
  const folder = (model: string, dir: string) => {
    const g = buildTemplate("explain-folder", "").graph;
    const a = g.nodes.find((n) => n.id === "explain")!;
    a.config = { ...a.config, model, folder: dir };
    return g;
  };

  it("asks for a model and a folder until both are picked", () => {
    const msgs = errors(buildTemplate("explain-folder", "mock/workflow").graph).map((i) => i.message);
    expect(msgs).toEqual(["Explain it: Pick a Claude Code or OpenCode model", "Explain it: Pick the project folder"]);
    expect(errors(folder("claude-code/sonnet", "")).map((i) => i.message)).toEqual(["Explain it: Pick the project folder"]);
    expect(errors(folder("mock/workflow", "/tmp/p")).map((i) => i.message)).toEqual(["Explain it: Pick a Claude Code or OpenCode model"]);
  });

  it("passes with a Claude Code or OpenCode model and a folder, with no leak warning, and is read-only", () => {
    for (const model of ["claude-code/sonnet", "opencode/anthropic/claude-sonnet-4"]) {
      const g = folder(model, "/tmp/project");
      expect(validateStructure(g)).toEqual([]);
      expect(checkGraph(g)).toEqual([]);
      const a = g.nodes.find((n) => n.id === "explain")!;
      expect(a.config.allowEdits).toBe(false);
      expect(a.config.tools).toEqual([]);
    }
  });

  it("does not accept Codex", () => {
    expect(errors(folder("codex/gpt-5", "/tmp/p")).map((i) => i.message).join("\n")).toContain("Codex can't run workflow cards");
  });

  it("refuses a web card after the folder card", () => {
    const g = folder("claude-code/sonnet", "/tmp/p");
    g.nodes.push({ id: "web", type: "fetch", fromIds: ["explain"], config: { url: "https://a.test/" }, ui: { label: "Fetch", position: { x: 900, y: 0 } } });
    expect(validateStructure(g).join("\n")).toContain("reads private data");
  });
});

describe("normalizeRepo", () => {
  it.each([
    ["vercel/next.js", "vercel/next.js"],
    [" vercel/next.js ", "vercel/next.js"],
    ["https://github.com/vercel/next.js", "vercel/next.js"],
    ["https://github.com/vercel/next.js/", "vercel/next.js"],
    ["https://www.github.com/vercel/next.js.git", "vercel/next.js"],
    ["http://github.com/vercel/next.js/tree/canary/packages?x=1#y", "vercel/next.js"],
    ["github.com/vercel/next.js", "vercel/next.js"],
    ["git@github.com:vercel/next.js.git", "vercel/next.js"],
    ["not a repo", "not a repo"],
  ])("%s -> %s", (input, out) => expect(normalizeRepo(input)).toBe(out));
});

describe("the New workflow menu entries", () => {
  it("lists the two explainers at the end, the folder one marked local", () => {
    expect(TEMPLATE_OPTIONS.map((t) => t.kind).slice(-2)).toEqual(["explain-repo", "explain-folder"]);
    const [repo, local] = TEMPLATE_OPTIONS.slice(-2);
    expect(repo).toMatchObject({ label: "Explain a GitHub repo" });
    expect(repo.local).toBeUndefined();
    expect(local).toMatchObject({ label: "Explain a project folder", local: true });
    expect(local.description).toMatch(/^Local only/);
    expect(isTemplateKind("explain-folder") && isTemplateKind("explain-repo") && !isTemplateKind("nope")).toBe(true);
  });
});
