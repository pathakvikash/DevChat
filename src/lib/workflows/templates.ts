import { emptyGraph, TRIGGER_ID, type WorkflowGraph } from "./graph";

export type TemplateKind = "blank" | "news";

export const TEMPLATE_OPTIONS: { kind: TemplateKind; label: string; description: string }[] = [
  { kind: "blank", label: "Blank", description: "Just the Run manually card." },
  { kind: "news", label: "News digest", description: "Search the web for your topics, have a model write a digest, post it to a new chat." },
];

/** The News digest: web search → save to the News table → keep the rows still marked new → digest → a new chat → mark those rows read. */
function news(defaultModel: string, tableId: string): WorkflowGraph {
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
      id: "save",
      type: "table",
      fromIds: ["news"],
      config: { tableId, action: "upsert", list: "{{news.items}}", keyField: "url", fields: [], status: "" },
      ui: { label: "Save to the News table", position: { x: 560, y: 0 } },
    },
    {
      id: "fresh",
      type: "filter",
      fromIds: ["save"],
      // Every saved row still marked new, not only the ones this run added: articles from a run that never posted are digested too.
      config: { list: "{{save.items}}", rules: [{ field: "{{item.status}}", op: "eq", value: "new" }], match: "all", stopIfEmpty: true },
      ui: { label: "New articles", position: { x: 840, y: 0 } },
    },
    {
      id: "digest",
      type: "agent",
      fromIds: ["fresh"],
      config: {
        instructions: "Write a short digest: one or two lines per article, grouped by topic, each with its link.",
        input: "{{fresh.items}}",
        model: "",
        tools: [],
        outputFields: [],
        preset: "Digest",
        perItem: false,
        items: "",
        maxItems: 25,
      },
      ui: { label: "Write the digest", position: { x: 1120, y: 0 } },
    },
    {
      id: "post",
      type: "chatMessage",
      fromIds: ["digest"],
      config: { chat: "new", title: "{{workflow.name}} — {{run.date}}", message: "{{digest.text}}" },
      ui: { label: "Post to a chat", position: { x: 1400, y: 0 } },
    },
    {
      id: "mark",
      type: "table",
      fromIds: ["post"],
      config: { tableId, action: "update", list: "{{fresh.items}}", keyField: "url", fields: [{ column: "url", value: "{{item.url}}" }], status: "read" },
      ui: { label: "Mark as read", position: { x: 1680, y: 0 } },
    },
  );
  return g;
}

/** `tableId` is the user's News table, for the Save card of the News template. */
export function buildTemplate(kind: TemplateKind, defaultModel = "", tableId = ""): { name: string; graph: WorkflowGraph } {
  if (kind === "news") return { name: "News digest", graph: news(defaultModel, tableId) };
  return { name: "Untitled workflow", graph: emptyGraph(defaultModel) };
}

export const isTemplateKind = (k: unknown): k is TemplateKind => k === "blank" || k === "news";
