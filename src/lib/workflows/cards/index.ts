import type { CardRun, CardStep, FlowNode } from "../graph";
import type { CardType } from "../catalog";
import type { TemplateContext } from "../template";
import { trigger } from "./trigger";
import { webSearchCard } from "./webSearch";
import { agentCard } from "./agent";
import { chatMessageCard } from "./chatMessage";
import { fetchCard } from "./fetch";
import { filterCard } from "./filter";
import { tableCard } from "./table";
import { mcpToolCard } from "./mcpTool";
import { jobBoardsCard } from "./jobBoards";
import { pickRowsCard } from "./pickRows";
import { sheetSyncCard } from "./sheetSync";

/** What a card gets when it runs. For a per-item card the runner calls `run` once per item, with `tctx.item` set. */
export interface CardCtx {
  userId: string;
  workflowId: string;
  node: FlowNode;
  /** The config after the card's schema applied its defaults. */
  config: Record<string, unknown>;
  tctx: TemplateContext;
  /** The graph's default model, for agent cards that name none. */
  defaultModel: string;
  signal: AbortSignal;
}

export interface CardOutcome {
  output: unknown;
  warnings?: string[];
  usage?: { inputTokens: number; outputTokens: number };
  log?: CardStep[];
  /** Per-item cards: progress and the first item errors. */
  items?: CardRun["items"];
  itemErrors?: CardRun["itemErrors"];
  /** The card is done but has nothing to hand on: it is Skipped with this reason. */
  skip?: string;
  /** The card is Done but the cards after it have nothing to work on: they are Skipped with this reason. */
  stop?: string;
  /** Pick rows: the card pauses the run. The runner saves it as Waiting and stops until `continueRun` hands it the rows. */
  wait?: CardRun["waiting"];
}

export interface CardImpl {
  run(c: CardCtx): Promise<CardOutcome>;
  /** Items run at once on a per-item card (default 1). */
  concurrency?(c: CardCtx): number;
}

export const CARDS: Record<CardType, CardImpl> = {
  trigger,
  webSearch: webSearchCard,
  agent: agentCard,
  chatMessage: chatMessageCard,
  fetch: fetchCard,
  filter: filterCard,
  table: tableCard,
  mcpTool: mcpToolCard,
  jobBoards: jobBoardsCard,
  pickRows: pickRowsCard,
  sheetSync: sheetSyncCard,
};
