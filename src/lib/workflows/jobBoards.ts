// Public job-board APIs (Greenhouse, Ashby, Lever): URL detection, parsers and the title/location rules. Pure, so the
// editor can check a pasted URL and the tests can run it on recorded fixtures. The fetching lives in cards/jobBoards.ts.
// Detection and rules follow career-ops `scan.mjs` (detectApi, buildTitleFilter, buildLocationFilter).
import { htmlToText } from "@/lib/net/htmlText";

export type BoardType = "greenhouse" | "ashby" | "lever";
export interface Board {
  type: BoardType;
  org: string;
  /** The API address. Built here from a checked slug, never taken from the pasted text, so it can only be one of three hosts. */
  apiUrl: string;
}
export interface Job {
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  source: BoardType;
}

export const SLUG_RE = /^[\w.-]+$/;
export const DESCRIPTION_CHARS = 4000;

const API: Record<BoardType, (org: string) => string> = {
  greenhouse: (org) => `https://boards-api.greenhouse.io/v1/boards/${org}/jobs?content=true`,
  ashby: (org) => `https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`,
  lever: (org) => `https://api.lever.co/v0/postings/${org}?mode=json`,
};
const HOSTS: Record<string, BoardType> = {
  "jobs.ashbyhq.com": "ashby",
  "jobs.lever.co": "lever",
  "job-boards.greenhouse.io": "greenhouse",
  "job-boards.eu.greenhouse.io": "greenhouse",
  "boards.greenhouse.io": "greenhouse",
};

export type Detected = { ok: true; board: Board } | { ok: false; error: string };

/**
 * A careers URL as one of the three board APIs. The scheme is optional. Only the host and the first path segment (the
 * organisation's slug, which must match `^[\w.-]+$`) are read; every other part of the pasted text is dropped.
 * A greenhouse API address (`boards-api.greenhouse.io/v1/boards/<org>/…`) is accepted too, as in `scan.mjs`.
 */
export function detectBoard(line: string): Detected {
  const text = line.trim();
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, error: `“${text}” is not a URL` };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: `“${text}” is not an http or https URL` };
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  let type: BoardType | undefined = HOSTS[host];
  let org = parts[0];
  if (host === "boards-api.greenhouse.io" && parts[0] === "v1" && parts[1] === "boards") {
    type = "greenhouse";
    org = parts[2];
  }
  if (!type) return { ok: false, error: `“${text}” is not a Greenhouse, Ashby or Lever careers URL` };
  if (!org || !SLUG_RE.test(org) || /^\.+$/.test(org)) return { ok: false, error: `“${text}” has no valid company name in it` };
  return { ok: true, board: { type, org, apiUrl: API[type](org) } };
}

export const boardLines = (text: unknown): string[] => String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, "&");
/** Plain text, cut at 4,000 characters. */
const plain = (s: string): string => decode(htmlToText(s)).slice(0, DESCRIPTION_CHARS);
/** "supabase" → "Supabase". The board APIs of Ashby and Lever do not name the company. */
const companyOf = (org: string) => org.charAt(0).toUpperCase() + org.slice(1);

/** Greenhouse's `content` is HTML escaped once more (`&lt;div&gt;`), so it is unescaped before the tags are dropped. */
function parseGreenhouse(json: unknown, org: string): Job[] {
  const jobs = isObject(json) && Array.isArray(json.jobs) ? json.jobs : [];
  return jobs.filter(isObject).map((j) => ({
    title: str(j.title),
    company: str(j.company_name) || companyOf(org),
    location: isObject(j.location) ? str(j.location.name) : "",
    url: str(j.absolute_url),
    description: plain(str(j.content).replace(/&lt;/g, "<").replace(/&gt;/g, ">")),
    source: "greenhouse",
  }));
}

function parseAshby(json: unknown, org: string): Job[] {
  const jobs = isObject(json) && Array.isArray(json.jobs) ? json.jobs : [];
  return jobs.filter(isObject).filter((j) => j.isListed !== false).map((j) => ({
    title: str(j.title),
    company: companyOf(org),
    location: str(j.location),
    url: str(j.jobUrl),
    description: str(j.descriptionPlain).slice(0, DESCRIPTION_CHARS) || plain(str(j.descriptionHtml)),
    source: "ashby",
  }));
}

function parseLever(json: unknown, org: string): Job[] {
  if (!Array.isArray(json)) return [];
  return json.filter(isObject).map((j) => {
    const categories = isObject(j.categories) ? j.categories : {};
    const lists = (Array.isArray(j.lists) ? j.lists : []).filter(isObject).map((l) => `${str(l.text)}: ${plain(str(l.content))}`);
    const description = [str(j.descriptionPlain) || plain(str(j.description)), ...lists, str(j.additionalPlain)].filter(Boolean).join("\n\n");
    return {
      title: str(j.text),
      company: companyOf(org),
      location: str(categories.location),
      url: str(j.hostedUrl),
      description: description.slice(0, DESCRIPTION_CHARS),
      source: "lever" as const,
    };
  });
}

/** The jobs in one board's response. A response of the wrong shape gives none (the card reports it). */
export function parseBoard(type: BoardType, json: unknown, org: string): Job[] {
  const jobs = type === "greenhouse" ? parseGreenhouse(json, org) : type === "ashby" ? parseAshby(json, org) : parseLever(json, org);
  return jobs.filter((j) => j.title && /^https?:\/\//i.test(j.url));
}

export interface JobFilters {
  titleInclude: string[];
  titleExclude: string[];
  locationAllow: string[];
  locationBlock: string[];
}
const lower = (l: string[]) => l.map((k) => k.toLowerCase());

/**
 * Case-insensitive substrings. An empty include list allows every title; an exclude match rejects. A job with no
 * location passes; a block match rejects, and beats allow; an empty allow list allows every location.
 */
export function jobPasses(job: Pick<Job, "title" | "location">, f: JobFilters): boolean {
  const title = job.title.toLowerCase();
  const include = lower(f.titleInclude);
  if (include.length > 0 && !include.some((k) => title.includes(k))) return false;
  if (lower(f.titleExclude).some((k) => title.includes(k))) return false;
  if (!job.location) return true;
  const where = job.location.toLowerCase();
  if (lower(f.locationBlock).some((k) => where.includes(k))) return false;
  const allow = lower(f.locationAllow);
  return allow.length === 0 || allow.some((k) => where.includes(k));
}
