import { describe, it, expect } from "vitest";
import { checkGraph, validateStructure } from "@/lib/workflows/graph";
import { buildTemplate, isTemplateKind, TEMPLATE_OPTIONS } from "@/lib/workflows/templates";
import { normalizeRepo, varValues } from "@/lib/workflows/vars";
import { parseGraph } from "@/lib/workflows/graph";
import { linkTarget, tooDeeplyNested } from "@/lib/markdownGuard";
import { readableText } from "@/lib/net/htmlText";

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

describe("the repo variable format", () => {
  it("the template marks its variable, reads a URL as owner/name, and keeps the mark through parseGraph", () => {
    const g = parseGraph(JSON.stringify(buildTemplate("explain-repo", "m").graph));
    expect(g.vars.find((v) => v.key === "repo")).toMatchObject({ format: "githubRepo", value: "octocat/Hello-World" });
    expect(varValues([{ key: "repo", label: "", value: "https://github.com/a/b/", format: "githubRepo" }])).toEqual({ repo: "a/b" });
  });

  it("a plain variable named repo is untouched, and the focus variable is not shared between graphs", () => {
    expect(varValues([{ key: "repo", label: "", value: "https://github.com/a/b/" }])).toEqual({ repo: "https://github.com/a/b/" });
    const a = buildTemplate("explain-repo").graph;
    const b = buildTemplate("explain-repo").graph;
    expect(a.vars[1]).not.toBe(b.vars[1]);
  });

  it("lists only the top level of the tree and points the agent at /contents/ for folders", () => {
    const g = buildTemplate("explain-repo").graph;
    expect(String(g.nodes.find((n) => n.id === "tree")!.config.url)).toBe("https://api.github.com/repos/{{vars.repo}}/git/trees/HEAD");
    expect(String(g.nodes.find((n) => n.id === "explain")!.config.instructions)).toContain("/contents/<folder>");
  });
});

describe("tooDeeplyNested", () => {
  it("catches the attack strings and leaves ordinary markdown alone", () => {
    expect(tooDeeplyNested("- ".repeat(2000))).toBe(true);
    expect(tooDeeplyNested(">".repeat(4000))).toBe(true);
    expect(tooDeeplyNested("1. ".repeat(40))).toBe(true);
    expect(tooDeeplyNested("- a\n  - b\n    - c\n> quote\n> > nested\n1. one\n2. two\n\n# Title\ntext")).toBe(false);
    const big = "- item\n".repeat(3000);
    const t = performance.now();
    expect(tooDeeplyNested(big)).toBe(false);
    expect(performance.now() - t).toBeLessThan(50);
  });
});

describe("linkTarget", () => {
  it("shows the host, or the whole address when there is none", () => {
    expect(linkTarget("https://evil.example/x?d=secret")).toBe("evil.example");
    expect(linkTarget("/relative/path")).toBe("/relative/path");
  });
});

describe("readableText", () => {
  const tsx = "const A = <T,>(p: Props<T>) => {\n  return <div className=\"x\">{p.a}</div>;\n};\n";
  it("keeps plain text, newlines and <Tags> as they are, and strips markup only from HTML or XML", () => {
    expect(readableText(tsx, "text/plain; charset=utf-8")).toBe(tsx);
    expect(readableText("<p>Hi <b>there</b></p>", "text/html")).toBe("Hi there");
    expect(readableText("<a>x</a>", "application/xml")).toBe("x");
  });
});
