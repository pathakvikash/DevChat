import { describe, it, expect } from "vitest";
import { renderTemplate, renderText, templateRefs, type TemplateContext } from "@/lib/workflows/template";

const ctx: TemplateContext = {
  nodes: { news: { items: [{ title: "A", url: "https://a.test" }, { title: "B", url: "https://b.test" }], count: 2 }, digest: { text: "Hello" } },
  vars: { topics: "ai\nrust" },
  item: { title: "Item title", score: 72 },
  index: 3,
  run: { id: "r1", date: "2026-11-09", startedAt: "2026-11-09T10:00:00.000Z" },
  workflow: { name: "News digest" },
};

describe("renderTemplate", () => {
  it("keeps the type of a lone reference", () => {
    expect(renderTemplate("{{news.items}}", ctx).value).toEqual(ctx.nodes.news && (ctx.nodes.news as { items: unknown }).items);
    expect(renderTemplate(" {{ news.count }} ", ctx).value).toBe(2);
    expect(renderTemplate("{{item.score}}", ctx).value).toBe(72);
  });

  it("returns a string for mixed text: strings as is, numbers through String, lists and objects as 2-space JSON", () => {
    expect(renderTemplate("n={{news.count}} {{digest.text}}", ctx).value).toBe("n=2 Hello");
    expect(renderTemplate("x {{news.items[0]}}", ctx).value).toBe(`x ${JSON.stringify({ title: "A", url: "https://a.test" }, null, 2)}`);
  });

  it("renders a missing value as empty and lists it once", () => {
    const r = renderTemplate("a {{nope.x}} b {{nope.x}} {{news.items[9].title}}", ctx);
    expect(r.value).toBe("a  b  ");
    expect(r.missing).toEqual(["nope.x", "news.items[9].title"]);
    expect(renderTemplate("{{nope}}", ctx)).toEqual({ value: "", missing: ["nope"] });
  });

  it("reads item, index, vars and run", () => {
    expect(renderTemplate("{{item.title}} #{{index}} {{vars.topics}} {{run.date}} {{workflow.name}}", ctx).value).toBe(
      "Item title #3 ai\nrust 2026-11-09 News digest",
    );
  });

  it("fences card output and item values but not vars, run, workflow or index", () => {
    const r = renderTemplate("{{digest.text}} | {{vars.topics}} | {{workflow.name}} | {{index}} | {{item.title}}", ctx, { fence: true });
    expect(r.value).toBe("```\nHello\n``` | ai\nrust | News digest | 3 | ```\nItem title\n```");
  });

  it("fences a lone card reference too, and widens the fence past backticks in the value", () => {
    const withTicks = { ...ctx, nodes: { ...ctx.nodes, digest: { text: "``` break out" } } };
    expect(renderTemplate("{{digest.text}}", withTicks, { fence: true }).value).toBe("````\n``` break out\n````");
  });

  it("lists the references in a template and renders any value to text", () => {
    expect(templateRefs("{{ a.b }} and {{vars.x}} {{ item }}")).toEqual(["a.b", "vars.x", "item"]);
    expect(renderText("{{news.count}}", ctx).text).toBe("2");
    expect(renderText("{{news.items}}", ctx).text).toContain('"title": "A"');
  });
});
