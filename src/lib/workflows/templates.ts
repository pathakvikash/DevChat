import { emptyGraph, TRIGGER_ID, type WorkflowGraph } from "./graph";

export type TemplateKind = "blank" | "news" | "jobs";

export const TEMPLATE_OPTIONS: { kind: TemplateKind; label: string; description: string }[] = [
  { kind: "blank", label: "Blank", description: "Just the Run manually card." },
  { kind: "news", label: "News digest", description: "Search the web for your topics, have a model write a digest, post it to a new chat." },
  { kind: "jobs", label: "Jobs", description: "Read company job boards, pick the jobs you like, and get a draft application for each. You submit it yourself." },
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
      // Rows this run's search returned that are still marked new: the ones it added, and ones an earlier run saved but never posted.
      // (Articles that the search no longer returns are not digested; they stay marked new.)
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

/** `tableId` is the user's News table (or Job leads table, for the Jobs template), for the Save card of the template. */
export function buildTemplate(kind: TemplateKind, defaultModel = "", tableId = ""): { name: string; graph: WorkflowGraph } {
  if (kind === "news") return { name: "News digest", graph: news(defaultModel, tableId) };
  if (kind === "jobs") return { name: "Jobs", graph: jobs(defaultModel, tableId) };
  return { name: "Untitled workflow", graph: emptyGraph(defaultModel) };
}

export const isTemplateKind = (k: unknown): k is TemplateKind => k === "blank" || k === "news" || k === "jobs";

// ─── Phase 3: the Jobs template ───

/** Instructions of the Draft application preset (4). The profile is the user's own text; the job is fenced data. */
export const DRAFT_INSTRUCTIONS =
  "Draft, never submit. Using my profile, write a cover letter under 250 words, 3–5 notes on tailoring my CV, and answers to the form's questions (fetch the job page; if it lists none, answer 'Why this company?' and 'Why you?'). Don't invent experience. If my profile is empty, say so in the cover letter instead of making one up.\n\nMy profile: {{vars.profile}}";

/**
 * The Jobs template: the public boards → save to the Job leads table (new jobs only get status `new`) → pause and pick →
 * a draft for each picked job (cover letter, CV notes, form answers, apply link) → save the drafts and mark the rows
 * `drafted`. Nothing is submitted: the draft card has only `fetchUrl`, and the user applies on the company's site.
 */
function jobs(defaultModel: string, tableId: string): WorkflowGraph {
  const g = emptyGraph(defaultModel);
  g.vars = [{ key: "profile", label: "Your profile (paste your CV or a short summary)", value: "" }];
  g.nodes.push(
    {
      id: "jobs",
      type: "jobBoards",
      fromIds: [TRIGGER_ID],
      config: {
        boards: "https://jobs.ashbyhq.com/supabase\nhttps://job-boards.greenhouse.io/vercel",
        titleInclude: "Frontend\nFull stack",
        titleExclude: "Intern",
        locationAllow: "Remote",
        locationBlock: "",
        maxItems: 200,
      },
      ui: { label: "Job boards", position: { x: 280, y: 0 } },
    },
    {
      id: "save",
      type: "table",
      fromIds: ["jobs"],
      // New jobs get status `new`. A job saved by an earlier run keeps its status, so `drafted` and `applied` stay.
      config: { tableId, action: "upsert", list: "{{jobs.items}}", keyField: "url", fields: [], status: "" },
      ui: { label: "Save to Job leads", position: { x: 560, y: 0 } },
    },
    {
      id: "pick",
      type: "pickRows",
      fromIds: ["save"],
      config: { tableId, statuses: "new", sortBy: "", maxPick: 10, message: "Draft application", setStatus: "picked" },
      ui: { label: "Pick jobs", position: { x: 840, y: 0 } },
    },
    {
      id: "draft",
      type: "agent",
      fromIds: ["pick"],
      config: {
        instructions: DRAFT_INSTRUCTIONS,
        input: "{{item}}",
        model: "",
        tools: ["fetchUrl"],
        outputFields: [
          { name: "coverLetter", type: "text", description: "The cover letter, under 250 words" },
          { name: "cvNotes", type: "text", description: "3 to 5 notes on tailoring my CV to this job" },
          { name: "answers", type: "text", description: "Answers to the application form's questions" },
          { name: "applyUrl", type: "text", description: "The link to apply" },
        ],
        preset: "Draft application",
        perItem: true,
        items: "{{pick.items}}",
        maxItems: 25,
      },
      ui: { label: "Draft application", position: { x: 1120, y: 0 } },
    },
    {
      id: "drafts",
      type: "table",
      fromIds: ["draft"],
      config: {
        tableId,
        action: "update",
        list: "{{draft.items}}",
        keyField: "url",
        fields: [
          { column: "url", value: "{{item.url}}" },
          { column: "coverLetter", value: "{{item.coverLetter}}" },
          { column: "cvNotes", value: "{{item.cvNotes}}" },
          { column: "answers", value: "{{item.answers}}" },
          { column: "applyUrl", value: "{{item.applyUrl}}" },
        ],
        status: "drafted",
      },
      ui: { label: "Save drafts", position: { x: 1400, y: 0 } },
    },
  );
  return g;
}
