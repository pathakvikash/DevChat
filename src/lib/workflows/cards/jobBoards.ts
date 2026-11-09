import { readFile } from "node:fs/promises";
import path from "node:path";
import { safeFetch } from "@/lib/net/safeFetch";
import { isSanityMode } from "@/lib/sanityMode";
import { boardLines, detectBoard, jobPasses, parseBoard, type Board, type BoardType, type Job } from "../jobBoards";
import { sleep } from "./webSearch";
import type { CardImpl } from "./index";

const CONCURRENCY = 5;
const TIMEOUT_MS = 15_000;
// A big Greenhouse board with `content=true` is a few MB of JSON. The hosts are fixed, so this is wider than safeFetch's 2 MB default.
const MAX_BYTES = 8 * 1024 * 1024;
const HEADERS = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; DevChat/1.0)" };

/** Sanity mode reads one recorded response per board type: no network. */
const FIXTURES: Record<BoardType, string> = { greenhouse: "greenhouse-vercel.json", ashby: "ashby-supabase.json", lever: "lever-spotify.json" };
const fixture = async (type: BoardType): Promise<unknown> => JSON.parse(await readFile(path.join(process.cwd(), "e2e/fixtures/workflows", FIXTURES[type]), "utf8"));

/** GET through safeFetch. One retry after 2 s on a 429 or 5xx. */
async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const get = () => safeFetch(url, { headers: HEADERS, signal, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES });
  let res = await get();
  if (res.status === 429 || res.status >= 500) {
    await sleep(2000, signal);
    if (signal.aborted) throw new Error("Cancelled");
    res = await get();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  try {
    return JSON.parse(res.text);
  } catch {
    throw new Error("The response is not valid JSON");
  }
}

async function loadBoard(b: Board, signal: AbortSignal): Promise<Job[]> {
  const json = isSanityMode() ? await fixture(b.type) : await getJson(b.apiUrl, signal);
  return parseBoard(b.type, json, b.org);
}

export const jobBoardsCard: CardImpl = {
  async run(c) {
    const lines = boardLines(c.config.boards);
    if (lines.length === 0) throw new Error("There are no careers pages to read");
    const errors: string[] = [];
    const boards: Board[] = [];
    // A bad address is checked before anything is fetched, and the other boards still run.
    for (const line of lines) {
      const d = detectBoard(line);
      if (d.ok) boards.push(d.board);
      else errors.push(d.error);
    }
    const found: Job[][] = new Array(boards.length).fill(null);
    let next = 0;
    // Boards are fetched 5 at a time; one that fails is an error line, not a failed card.
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, boards.length) }, async () => {
        while (next < boards.length && !c.signal.aborted) {
          const i = next++;
          const b = boards[i];
          try {
            found[i] = await loadBoard(b, c.signal);
          } catch (e) {
            errors.push(`${b.org} (${b.type}): ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }),
    );
    if (c.signal.aborted) throw new Error("Cancelled");
    if (found.every((f) => f === null)) throw new Error(errors[0] ?? "Every board failed");

    const filters = {
      titleInclude: boardLines(c.config.titleInclude),
      titleExclude: boardLines(c.config.titleExclude),
      locationAllow: boardLines(c.config.locationAllow),
      locationBlock: boardLines(c.config.locationBlock),
    };
    const seen = new Set<string>();
    const kept: Job[] = [];
    for (const job of found.flat().filter((j): j is Job => !!j)) {
      if (seen.has(job.url) || !jobPasses(job, filters)) continue;
      seen.add(job.url);
      kept.push(job);
    }
    const max = Number(c.config.maxItems) || 200;
    const warnings = errors.slice(0, 10);
    if (kept.length > max) warnings.push(`Kept the first ${max} of ${kept.length} matching jobs`);
    const items = kept.slice(0, max);
    return { output: { items, count: items.length, errors }, warnings };
  },
};
