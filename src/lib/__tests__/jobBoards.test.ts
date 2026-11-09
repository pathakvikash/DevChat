import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

const safeFetch = vi.fn();
vi.mock("@/lib/net/safeFetch", () => ({ safeFetch: (...a: unknown[]) => safeFetch(...a), SafeFetchError: class extends Error {} }));
let sanity = false;
vi.mock("@/lib/sanityMode", () => ({ isSanityMode: () => sanity }));

import { boardLines, detectBoard, jobPasses, parseBoard, type Board, type Job } from "@/lib/workflows/jobBoards";
import { jobBoardsCard } from "@/lib/workflows/cards/jobBoards";
import { buildTemplate } from "@/lib/workflows/templates";
import { checkGraph } from "@/lib/workflows/graph";
import { reachesOpenWeb, reachesWeb } from "@/lib/workflows/catalog";
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

beforeEach(() => {
  safeFetch.mockReset();
  sanity = false;
});

describe("the Job boards card", () => {
  it("fetches each board's API address through safeFetch and keeps the matching jobs, deduped by link", async () => {
    safeFetch.mockImplementation(async (url: string) => ok(url.includes("greenhouse") ? GH : url.includes("ashby") ? ASHBY : LEVER));
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
      return ok(ASHBY);
    });
    const r = await jobBoardsCard.run(ctx({ boards: "https://jobs.lever.co/gone\nhttps://jobs.ashbyhq.com/supabase" }));
    expect((r.output as { count: number }).count).toBe(3);
    expect((r.output as { errors: string[] }).errors).toEqual(["gone (lever): HTTP 404"]);
    expect(r.warnings).toEqual(["gone (lever): HTTP 404"]);
  });

  it("a response that is not JSON is that board's error", async () => {
    safeFetch.mockResolvedValue({ status: 200, ok: true, url: "", contentType: "text/html", text: "<html>" });
    await expect(jobBoardsCard.run(ctx({ boards: "https://jobs.lever.co/x" }))).rejects.toThrow("The response is not valid JSON");
  });

  it("a 5xx is tried once more; every board failing fails the card", async () => {
    vi.useFakeTimers();
    try {
      safeFetch.mockResolvedValue({ status: 503, ok: false, url: "", contentType: "", text: "" });
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
    safeFetch.mockResolvedValue(ok(LEVER));
    const r = await jobBoardsCard.run(ctx({ boards: "https://example.com/x\nhttps://jobs.lever.co/spotify" }));
    expect(r.warnings?.[0]).toContain("not a Greenhouse, Ashby or Lever careers URL");
    expect((r.output as { count: number }).count).toBe(4);
  });

  it("keeps at most maxItems, with a warning", async () => {
    safeFetch.mockResolvedValue(ok(GH));
    const r = await jobBoardsCard.run(ctx({ boards: "https://job-boards.greenhouse.io/vercel", maxItems: 2 }));
    expect((r.output as { items: unknown[] }).items).toHaveLength(2);
    expect(r.warnings).toEqual(["Kept the first 2 of 4 matching jobs"]);
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
    expect(draft.config.tools).toEqual(["fetchUrl"]);
    expect(draft.config.mcpTools).toBeUndefined();
    expect(draft.config.folder).toBeUndefined();
    expect(graph.nodes.find((n) => n.id === "drafts")!.config).toMatchObject({ action: "update", status: "drafted" });
    expect(graph.vars.map((v) => v.key)).toEqual(["profile"]);
  });

  it("a Job boards card with no valid address is an error on the card", () => {
    const { graph } = buildTemplate("jobs", "m", "t");
    graph.nodes[1].config.boards = "https://example.com/a";
    expect(checkGraph(graph).find((i) => i.nodeId === "jobs")?.message).toContain("not a Greenhouse, Ashby or Lever careers URL");
    graph.nodes[1].config.boards = "";
    expect(checkGraph(graph).find((i) => i.nodeId === "jobs")?.message).toContain("add at least one careers page");
  });
});
