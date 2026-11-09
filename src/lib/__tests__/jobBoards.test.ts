import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

const safeFetch = vi.fn();
vi.mock("@/lib/net/safeFetch", () => ({ safeFetch: (...a: unknown[]) => safeFetch(...a), SafeFetchError: class extends Error {} }));
let sanity = false;
vi.mock("@/lib/sanityMode", () => ({ isSanityMode: () => sanity }));
// capOutput lives in the runner, which imports the database; nothing here queries it.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { boardLines, DESCRIPTION_CHARS, detectBoard, jobPasses, parseBoard, type Board, type Job } from "@/lib/workflows/jobBoards";
import { capOutput } from "@/lib/workflows/runner";
import { jobBoardsCard } from "@/lib/workflows/cards/jobBoards";
import { buildTemplate } from "@/lib/workflows/templates";
import { checkGraph } from "@/lib/workflows/graph";
import { DEFAULT_MAX_JOBS, reachesOpenWeb, reachesWeb } from "@/lib/workflows/catalog";
import type { CardCtx } from "@/lib/workflows/cards";

const fx = (name: string): unknown => JSON.parse(readFileSync(path.join(process.cwd(), "e2e/fixtures/workflows", name), "utf8"));
const GH = fx("greenhouse-vercel.json");
const ASHBY = fx("ashby-supabase.json");
const LEVER = fx("lever-spotify.json");
const board = (line: string): Board => {
  const d = detectBoard(line);
  if (!d.ok) throw new Error(d.error);
  return d.board;
};

describe("detectBoard (the cases of scan.mjs detectApi)", () => {
  it("Ashby", () => {
    expect(board("https://jobs.ashbyhq.com/supabase")).toEqual({ type: "ashby", org: "supabase", apiUrl: "https://api.ashbyhq.com/posting-api/job-board/supabase?includeCompensation=true" });
    expect(board("jobs.ashbyhq.com/supabase/05226c15-0501").org).toBe("supabase"); // a job page, no scheme: the first segment is the company
    expect(board("https://jobs.ashbyhq.com/supabase?utm_source=x#top").org).toBe("supabase");
  });

  it("Lever", () => {
    expect(board("https://jobs.lever.co/spotify")).toEqual({ type: "lever", org: "spotify", apiUrl: "https://api.lever.co/v0/postings/spotify?mode=json" });
    expect(board("https://jobs.lever.co/spotify/2a55d6c9-c564").org).toBe("spotify");
  });

  it("Greenhouse: job-boards, the EU host, the old boards host, and the API address", () => {
    const api = "https://boards-api.greenhouse.io/v1/boards/vercel/jobs?content=true";
    expect(board("https://job-boards.greenhouse.io/vercel")).toEqual({ type: "greenhouse", org: "vercel", apiUrl: api });
    // Checked against the real network on 2026-11-10: there is no boards-api.eu.greenhouse.io, and EU companies' boards answer on the main API host.
    expect(board("https://job-boards.eu.greenhouse.io/vercel").apiUrl).toBe(api);
    expect(board("https://boards.greenhouse.io/vercel/jobs/6231864004").apiUrl).toBe(api);
    expect(board("https://boards-api.greenhouse.io/v1/boards/vercel/jobs").apiUrl).toBe(api);
  });

  it("an address on any other host is not a board, and its text never reaches the API address", () => {
    for (const line of ["https://example.com/supabase", "https://evil.test/?x=jobs.ashbyhq.com/supabase", "https://jobs.ashbyhq.com.evil.test/supabase", "https://api.lever.co/v0/postings/x", "not a url at all"]) {
      expect(detectBoard(line).ok, line).toBe(false);
    }
    expect(detectBoard("ftp://jobs.lever.co/spotify").ok).toBe(false);
  });

  it("a slug that does not match ^[\\w.-]+$ is rejected, and so is one made of dots only", () => {
    for (const line of ["https://jobs.lever.co/", "https://jobs.lever.co/a%2Fb", "https://jobs.lever.co/a b", "https://jobs.lever.co/%2e%2e", "https://jobs.lever.co/a@b"]) {
      expect(detectBoard(line).ok, line).toBe(false);
    }
    expect(board("https://jobs.lever.co/acme.inc-2_x").org).toBe("acme.inc-2_x");
  });

  it("boardLines drops blanks and spaces", () => {
    expect(boardLines(" a \n\n b\n")).toEqual(["a", "b"]);
    expect(boardLines(undefined)).toEqual([]);
  });
});

describe("the parsers, on recorded responses", () => {
  it("Greenhouse: title, company, location, link, and a plain-text description from escaped HTML", () => {
    const jobs = parseBoard("greenhouse", GH, "vercel");
    expect(jobs).toHaveLength(4);
    expect(jobs[0]).toMatchObject({ title: "Customer Support Engineer", company: "Vercel", source: "greenhouse" });
    expect(jobs[0].url).toMatch(/^https:\/\/job-boards\.greenhouse\.io\/vercel\/jobs\/\d+$/);
    expect(jobs[0].location).toBe("Hybrid - Sydney");
    expect(jobs[0].description).toContain("About Vercel");
    expect(jobs[0].description).not.toMatch(/&lt;|&gt;|<div|&quot;/);
    expect(jobs.every((j) => j.description.length > 0 && j.description.length <= 4000)).toBe(true);
  });

  it("Ashby: the plain description, the company from the slug", () => {
    const jobs = parseBoard("ashby", ASHBY, "supabase");
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({ title: "Software Engineer - Branching", company: "Supabase", source: "ashby", location: "Remote, Global" });
    expect(jobs[0].url).toMatch(/^https:\/\/jobs\.ashbyhq\.com\/supabase\//);
    expect(jobs[0].description.length).toBeGreaterThan(100);
  });

  it("Lever: text, hosted link, category location, description with the lists", () => {
    const jobs = parseBoard("lever", LEVER, "spotify");
    expect(jobs).toHaveLength(4);
    expect(jobs[0]).toMatchObject({ title: "AV Engineer - Platform", company: "Spotify", source: "lever", location: "Stockholm" });
    expect(jobs[0].url).toMatch(/^https:\/\/jobs\.lever\.co\/spotify\//);
    expect(jobs[0].description.length).toBeGreaterThan(100);
  });

  it("a response of the wrong shape gives no jobs, and a job with no title or link is dropped", () => {
    expect(parseBoard("greenhouse", { nope: 1 }, "x")).toEqual([]);
    expect(parseBoard("lever", { jobs: [] }, "x")).toEqual([]);
    expect(parseBoard("ashby", null, "x")).toEqual([]);
    expect(parseBoard("lever", [{ text: "No link" }, { hostedUrl: "https://jobs.lever.co/x/1" }, { text: "Javascript link", hostedUrl: "javascript:alert(1)" }], "x")).toEqual([]);
  });

  it("an unlisted Ashby job is left out", () => {
    const json = { jobs: [{ title: "Hidden", jobUrl: "https://jobs.ashbyhq.com/x/1", isListed: false }, { title: "Shown", jobUrl: "https://jobs.ashbyhq.com/x/2", isListed: true }] };
    expect(parseBoard("ashby", json, "x").map((j) => j.title)).toEqual(["Shown"]);
  });
});

describe("title and location rules", () => {
  const none = { titleInclude: [], titleExclude: [], locationAllow: [], locationBlock: [] };
  const job = (title: string, location = "") => ({ title, location });

  it("an empty include list allows every title; matching is a case-insensitive substring; exclude wins", () => {
    expect(jobPasses(job("Anything"), none)).toBe(true);
    const f = { ...none, titleInclude: ["frontend", "Full Stack"], titleExclude: ["intern"] };
    expect(jobPasses(job("Senior FRONTEND Engineer"), f)).toBe(true);
    expect(jobPasses(job("Full-stack dev"), f)).toBe(false); // "full stack" is not a substring of "full-stack"
    expect(jobPasses(job("Full Stack Developer"), f)).toBe(true);
    expect(jobPasses(job("Frontend Intern"), f)).toBe(false);
    expect(jobPasses(job("Backend Engineer"), f)).toBe(false);
  });

  it("a job with no location passes; block beats allow; an empty allow list allows every place", () => {
    const f = { ...none, locationAllow: ["remote", "india"], locationBlock: ["us only"] };
    expect(jobPasses(job("x", ""), f)).toBe(true);
    expect(jobPasses(job("x", "Remote, Global"), f)).toBe(true);
    expect(jobPasses(job("x", "Bengaluru, INDIA"), f)).toBe(true);
    expect(jobPasses(job("x", "Remote (US only)"), f)).toBe(false);
    expect(jobPasses(job("x", "Paris"), f)).toBe(false);
    expect(jobPasses(job("x", "Paris"), { ...none, locationBlock: ["tokyo"] })).toBe(true);
  });
});

const ctx = (config: Record<string, unknown>, signal = new AbortController().signal) =>
  ({ config: { boards: "", titleInclude: "", titleExclude: "", locationAllow: "", locationBlock: "", maxItems: 200, ...config }, tctx: {}, signal }) as unknown as CardCtx;
const ok = (body: unknown) => ({ status: 200, ok: true, url: "", contentType: "application/json", text: JSON.stringify(body) });
/** The answer of safeFetch: `url` is where it ended up, which must be the host asked for. */
const reply = (r: object) => async (url: string) => ({ ...r, url });

beforeEach(() => {
  safeFetch.mockReset();
  sanity = false;
});

describe("the Job boards card", () => {
  it("fetches each board's API address through safeFetch and keeps the matching jobs, deduped by link", async () => {
    safeFetch.mockImplementation(async (url: string) => ({ ...ok(url.includes("greenhouse") ? GH : url.includes("ashby") ? ASHBY : LEVER), url }));
    const r = await jobBoardsCard.run(
      ctx({ boards: "https://job-boards.greenhouse.io/vercel\nhttps://jobs.ashbyhq.com/supabase\nhttps://jobs.lever.co/spotify\nhttps://jobs.lever.co/spotify", titleInclude: "engineer", titleExclude: "director\nsupport" }),
    );
    expect(safeFetch.mock.calls.map((c) => c[0]).sort()).toEqual([
      "https://api.ashbyhq.com/posting-api/job-board/supabase?includeCompensation=true",
      "https://api.lever.co/v0/postings/spotify?mode=json",
      "https://api.lever.co/v0/postings/spotify?mode=json",
      "https://boards-api.greenhouse.io/v1/boards/vercel/jobs?content=true",
    ]);
    const out = r.output as { items: Job[]; count: number; errors: string[] };
    expect(out.errors).toEqual([]);
    expect(out.items.map((j) => j.title)).not.toContain("Engineering Director, Vercel for Platforms");
    expect(out.items.map((j) => j.title)).not.toContain("Support Engineer (APAC)");
    expect(out.items.every((j) => /engineer/i.test(j.title))).toBe(true);
    expect(new Set(out.items.map((j) => j.url)).size).toBe(out.items.length); // the second Lever line gave the same links
    expect(out.count).toBe(out.items.length);
    expect(out.items.map((j) => j.source)).toContain("lever");
  });

  it("one failing board is a warning, and the others still give their jobs", async () => {
    safeFetch.mockImplementation(async (url: string) => {
      if (url.includes("lever")) return { status: 404, ok: false, url, contentType: "", text: "" };
      return { ...ok(ASHBY), url };
    });
    const r = await jobBoardsCard.run(ctx({ boards: "https://jobs.lever.co/gone\nhttps://jobs.ashbyhq.com/supabase" }));
    expect((r.output as { count: number }).count).toBe(3);
    expect((r.output as { errors: string[] }).errors).toEqual(["gone (lever): HTTP 404"]);
    expect(r.warnings).toEqual(["gone (lever): HTTP 404"]);
  });

  it("a response that is not JSON is that board's error", async () => {
    safeFetch.mockImplementation(reply({ status: 200, ok: true, url: "", contentType: "text/html", text: "<html>" }));
    await expect(jobBoardsCard.run(ctx({ boards: "https://jobs.lever.co/x" }))).rejects.toThrow("The response is not valid JSON");
  });

  it("a 5xx is tried once more; every board failing fails the card", async () => {
    vi.useFakeTimers();
    try {
      safeFetch.mockImplementation(reply({ status: 503, ok: false, url: "", contentType: "", text: "" }));
      const p = jobBoardsCard.run(ctx({ boards: "https://jobs.lever.co/x" }));
      const caught = p.catch((e: Error) => e);
      await vi.advanceTimersByTimeAsync(2500);
      expect(((await caught) as Error).message).toBe("x (lever): HTTP 503");
      expect(safeFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a bad address is refused before anything is fetched; with only bad ones the card fails", async () => {
    await expect(jobBoardsCard.run(ctx({ boards: "http://169.254.169.254/latest\nhttps://jobs.lever.co/a%2F" }))).rejects.toThrow(/not a Greenhouse, Ashby or Lever careers URL/);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("a bad address next to a good one is a warning", async () => {
    safeFetch.mockImplementation(reply(ok(LEVER)));
    const r = await jobBoardsCard.run(ctx({ boards: "https://example.com/x\nhttps://jobs.lever.co/spotify" }));
    expect(r.warnings?.[0]).toContain("not a Greenhouse, Ashby or Lever careers URL");
    expect((r.output as { count: number }).count).toBe(4);
  });

  it("keeps at most maxItems, with a warning", async () => {
    safeFetch.mockImplementation(reply(ok(GH)));
    const r = await jobBoardsCard.run(ctx({ boards: "https://job-boards.greenhouse.io/vercel", maxItems: 2 }));
    expect((r.output as { items: unknown[] }).items).toHaveLength(2);
    expect(r.warnings).toEqual(["Kept the first 2 of 4 matching jobs"]);
  });

  it("a board whose answer comes from another host after a redirect fails, and its body is not read", async () => {
    safeFetch.mockImplementation(async () => ({ ...ok(LEVER), url: "https://evil.test/v0/postings/spotify" }));
    await expect(jobBoardsCard.run(ctx({ boards: "https://jobs.lever.co/spotify" }))).rejects.toThrow("spotify (lever): The board redirected to another address");
    // another board still gives its jobs
    safeFetch.mockImplementation(async (url: string) => (url.includes("lever") ? { ...ok(LEVER), url: "https://evil.test/x" } : { ...ok(ASHBY), url }));
    const r = await jobBoardsCard.run(ctx({ boards: "https://jobs.lever.co/spotify\nhttps://jobs.ashbyhq.com/supabase" }));
    expect(r.warnings).toEqual(["spotify (lever): The board redirected to another address"]);
    expect((r.output as { count: number }).count).toBe(3);
  });

  it("a big board through the card and the output cap: the default keeps every job in the run record, and a cut says so with the right count", async () => {
    const big = Array.from({ length: 200 }, (_, i) => ({ id: `j${i}`, text: `Engineer ${i}`, hostedUrl: `https://jobs.lever.co/big/${i}`, categories: { location: "Remote" }, descriptionPlain: "x".repeat(6000) }));
    safeFetch.mockImplementation(reply(ok(big)));
    // the default (60) is the point of DESCRIPTION_CHARS = 2,500: all of it fits under 200 KB
    const r = await jobBoardsCard.run(ctx({ boards: "https://jobs.lever.co/big", maxItems: DEFAULT_MAX_JOBS }));
    const out = r.output as { items: Job[]; count: number };
    expect(out.count).toBe(60);
    expect(out.items.every((j) => j.description.length <= DESCRIPTION_CHARS)).toBe(true);
    expect(JSON.stringify(capOutput(r.output)).length).toBeLessThanOrEqual(200_000);
    expect((capOutput(r.output) as { truncated?: boolean }).truncated).toBeUndefined();
    // a user who raises the cap past what fits: the runner cuts, warns, and count says what was kept
    const all = await jobBoardsCard.run(ctx({ boards: "https://jobs.lever.co/big", maxItems: 200 }));
    const capped = capOutput(all.output) as { items: unknown[]; truncated: boolean };
    expect(capped.truncated).toBe(true);
    expect(capped.items.length).toBeLessThan(200);
    expect(DESCRIPTION_CHARS).toBe(2500);
  });

  it("no addresses at all fails the card", async () => {
    await expect(jobBoardsCard.run(ctx({ boards: " \n" }))).rejects.toThrow("There are no careers pages to read");
  });

  it("sanity mode reads the recorded responses and never the network", async () => {
    sanity = true;
    const r = await jobBoardsCard.run(ctx({ boards: "https://jobs.ashbyhq.com/anyone\nhttps://jobs.lever.co/anyone\nhttps://job-boards.greenhouse.io/anyone" }));
    expect(safeFetch).not.toHaveBeenCalled();
    expect((r.output as { count: number }).count).toBe(11);
  });
});

describe("Job boards in the catalog", () => {
  it("counts as reaching the web (open web, so MCP-only data may not go to it)", () => {
    expect(reachesOpenWeb("jobBoards", {})).toBe(true);
    expect(reachesWeb("jobBoards", {})).toBe(true);
  });

  it("the Jobs template is a valid flow with its table, and its draft card has only fetchUrl", () => {
    const { graph } = buildTemplate("jobs", "mock/workflow", "tbl1");
    expect(graph.nodes.map((n) => n.type)).toEqual(["trigger", "jobBoards", "table", "pickRows", "agent", "table"]);
    expect(checkGraph(graph).filter((i) => !i.warning)).toEqual([]);
    const draft = graph.nodes.find((n) => n.id === "draft")!;
    // no tools at all: it reads the profile next to untrusted job text, so it must not reach the web
    expect(draft.config.tools).toEqual([]);
    expect(draft.config.mcpTools).toBeUndefined();
    expect(draft.config.folder).toBeUndefined();
    expect(String(draft.config.instructions)).not.toMatch(/fetch/i);
    expect((draft.config.outputFields as { name: string }[]).map((f) => f.name)).toEqual(["coverLetter", "cvNotes", "answers"]);
    const drafts = graph.nodes.find((n) => n.id === "drafts")!;
    expect(drafts.config).toMatchObject({ action: "update", status: "drafted" });
    // the apply link is the board's own URL, not something the model wrote
    expect((drafts.config.fields as { column: string; value: string }[]).find((f) => f.column === "applyUrl")).toEqual({ column: "applyUrl", value: "{{item.url}}" });
    expect(graph.nodes.find((n) => n.id === "pick")!.config).toMatchObject({ statuses: "new,picked", maxPick: 10 });
    expect(graph.nodes.find((n) => n.id === "jobs")!.config.maxItems).toBe(60);
    expect(graph.vars.map((v) => v.key)).toEqual(["profile"]);
  });

  it("Pick rows: empty statuses is an error, maxPick above 25 is refused, and a per-item card with a lower maxItems is a warning", () => {
    const { graph } = buildTemplate("jobs", "m", "t");
    const pick = graph.nodes.find((n) => n.id === "pick")!;
    const draft = graph.nodes.find((n) => n.id === "draft")!;
    expect(checkGraph(graph).filter((i) => i.nodeId === "pick" || i.nodeId === "draft")).toEqual([]);
    pick.config.statuses = " , ";
    expect(checkGraph(graph).find((i) => i.nodeId === "pick" && !i.warning)?.message).toContain("add at least one status to offer");
    pick.config.statuses = "new";
    pick.config.maxPick = 26;
    expect(checkGraph(graph).find((i) => i.nodeId === "pick" && !i.warning)?.message).toContain("maxPick");
    pick.config.maxPick = 25;
    draft.config.maxItems = 10;
    const w = checkGraph(graph).find((i) => i.nodeId === "draft");
    expect(w).toMatchObject({ warning: true, field: "maxItems" });
    expect(w?.message).toContain("at most 10 items");
    draft.config.maxItems = 25;
    expect(checkGraph(graph).filter((i) => i.nodeId === "draft")).toEqual([]);
  });

  it("a Job boards card with no valid address is an error on the card", () => {
    const { graph } = buildTemplate("jobs", "m", "t");
    graph.nodes[1].config.boards = "https://example.com/a";
    expect(checkGraph(graph).find((i) => i.nodeId === "jobs")?.message).toContain("not a Greenhouse, Ashby or Lever careers URL");
    graph.nodes[1].config.boards = "";
    expect(checkGraph(graph).find((i) => i.nodeId === "jobs")?.message).toContain("add at least one careers page");
  });
});
