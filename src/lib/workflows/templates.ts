import { emptyGraph, TRIGGER_ID, type WorkflowGraph } from "./graph";

export type TemplateKind = "blank" | "news";

export const TEMPLATE_OPTIONS: { kind: TemplateKind; label: string; description: string }[] = [
  { kind: "blank", label: "Blank", description: "Just the Run manually card." },
  { kind: "news", label: "News digest", description: "Search the web for your topics, have a model write a digest, post it to a new chat." },
];

/** The phase-1 News digest: web search → digest → a new chat. (The full version adds a table and a filter in phase 2.) */
function news(defaultModel: string): WorkflowGraph {
  const g = emptyGraph(defaultModel);
  g.vars = [{ key: "topics", label: "Topics to search, one per line", value: "AI developer tools news\nopen source LLM releases" }];
  g.nodes.push(
    {
      id: "news",
      type: "webSearch",
      fromIds: [TRIGGER_ID],
      config: { queries: "{{vars.topics}}", provider: "", perItem: false, items: "", maxItems: 25 },
      ui: { label: "Search the news", position: { x: 280, y: 0 } },
    },
    {
      id: "digest",
      type: "agent",
      fromIds: ["news"],
      config: {
        instructions: "Write a short digest: one or two lines per article, grouped by topic, each with its link.",
        input: "{{news.items}}",
        model: "",
        tools: [],
        outputFields: [],
        preset: "Digest",
        perItem: false,
        items: "",
        maxItems: 25,
      },
      ui: { label: "Write the digest", position: { x: 560, y: 0 } },
    },
    {
      id: "post",
      type: "chatMessage",
      fromIds: ["digest"],
      config: { chat: "new", title: "{{workflow.name}} — {{run.date}}", message: "{{digest.text}}" },
      ui: { label: "Post to a chat", position: { x: 840, y: 0 } },
    },
  );
  return g;
}

export function buildTemplate(kind: TemplateKind, defaultModel = ""): { name: string; graph: WorkflowGraph } {
  if (kind === "news") return { name: "News digest", graph: news(defaultModel) };
  return { name: "Untitled workflow", graph: emptyGraph(defaultModel) };
}

export const isTemplateKind = (k: unknown): k is TemplateKind => k === "blank" || k === "news";
