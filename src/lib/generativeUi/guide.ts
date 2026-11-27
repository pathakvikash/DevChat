import { catalog } from "./catalog";

/** Extra rules appended to the json-render catalog prompt. Exported so tests
 *  exercise the same wording the chat route ships. */
export const GENERATIVE_UI_RULES = [
  "When the user asks for a table, chart, graph, comparison, or anything visual, render it with the `Table` / `Chart` (or, for market candles, `CandleChart`) components. Never draw charts with Python/matplotlib, never print ASCII tables, and never describe a chart in prose instead of rendering it.",
  "Get the facts with tools first (`webSearch` etc.) when you don't already have them — tools and UI components work together in the same turn.",
  'HARD LIMIT: never type more than 12 values (cells or chart points) into a spec, and never put the same dataset in two components. Past that — including data you got from a tool result or already know — first save it once: `executeCode` with `saveAs: { title }` (the code MUST print the dataset as its last statement: `print(json.dumps({"columns": [...], "rows": [[...]]}))` or CSV — only stdout is captured, so returning or assigning it saves nothing) or `createArtifact` type "data". Both return an artifact id; reference it from every component with `dataArtifactId` (Chart also takes `labelColumn`/`valueColumn`; Table takes `columns` to pick a subset), and let one Table and one Chart share that id instead of each carrying its own copy of the rows.',
  "Connected apps (loaded with `loadAppTools`) return typed results; render each with the matching component: a `timeseries` result -> `Chart` (type \"line\" or \"area\", multi-series, time axis); an `ohlc` result -> `CandleChart` (candlesticks + volume); a `model3d` result -> `Model3D` (interactive STL viewer, appId + file copied exactly, `openLink` only a deep-link name from the app); a `job` result -> `JobCard` (appId, jobId, statusTool copied exactly; it polls and renders the finished result itself, so do not also render the result); a `table` result -> `Table`. Never put more than 12 values of any of these inline: the tool result gives you a `dataArtifactId`, reference it (`Chart`, `Table` and `CandleChart` all take it, with symbol/interval null for CandleChart). Never invent app ids, job ids or file ids.",
  'Data honesty: every value shown must come from the conversation, an attachment or a tool result. If the user asks for a chart, table or dashboard and you have no data, ask for it, or build it with clearly labelled sample data: put "Sample data" in the title or caption, and never present invented numbers as real.',
  "Only generate a UI component when it clearly helps — e.g. the user asks to see/show/display something structured. Plain questions get plain text answers.",
  "The JSONL patch fence MUST be exactly a markdown code fence: an opening line of exactly ```spec and a closing line of exactly ``` (three backticks, nothing else on those lines). Do NOT use any other wrapper — no <spec> tags, no other XML/HTML-style tags, no custom delimiters. Only ```spec ... ``` is recognized; anything else will be shown to the user as literal broken text.",
];

/** The full guide: component catalog plus rules. Served by the loadUiGuide tool. */
export const uiGuideText = () => catalog.prompt({ mode: "inline", customRules: GENERATIVE_UI_RULES });

/** What every tool-capable chat carries instead of the guide. */
export const GENERATIVE_UI_STUB =
  "You can render tables, charts and forms in the chat. Before writing any ```spec block, call the loadUiGuide tool once and follow its output exactly. Never write a spec without loading the guide first. Plain questions get plain text. Shown data must come from the chat, an attachment or a tool result; with none, ask for it or label it \"Sample data\" in the title or caption.";

const UI_KEYWORDS = /\b(tables?|charts?|graphs?|plots?|compar(?:e|es|ing|isons?)|visuali[sz](?:e|es|ing)|dashboards?|forms?|show me|display)\b/i;

const partsOf = (m: any): any[] => (Array.isArray(m?.parts) ? m.parts : []);
const textOf = (m: any): string =>
  typeof m?.content === "string" ? m.content : partsOf(m).map((p) => (p?.type === "text" ? p.text ?? "" : "")).join("");

/** A spec fence or generative UI part already in history. */
const hasSpec = (ms: any[]) =>
  ms.some((m) => textOf(m).includes("```spec") || partsOf(m).some((p) => typeof p?.type === "string" && /^data-(spec|ui)/.test(p.type)));

/** Models without tools cannot call loadUiGuide: inline the guide only when the latest user message asks for something visual, or a spec is already in history. */
export function shouldInlineUiGuide(messages: unknown[]): boolean {
  const ms = (messages ?? []) as any[];
  if (hasSpec(ms)) return true;
  const last = [...ms].reverse().find((m) => m?.role === "user");
  return !!last && UI_KEYWORDS.test(textOf(last));
}
