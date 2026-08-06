import { readdirSync, statSync, existsSync, createReadStream } from "fs";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

export const CLAUDE_DIR = join(homedir(), ".claude");
export const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

export interface ClaudeProject {
  /** Directory name under ~/.claude/projects (the encoded cwd). */
  slug: string;
  /** The real working directory, read from a transcript. */
  cwd: string;
  sessionCount: number;
  /** Most recent session mtime, ISO. */
  lastActive: string | null;
}

export interface ClaudeSession {
  id: string;
  projectSlug: string;
  cwd: string | null;
  title: string | null;
  gitBranch: string | null;
  lastPrompt: string | null;
  userMessages: number;
  assistantMessages: number;
  modified: string;
  sizeBytes: number;
}

/**
 * Reads the real cwd out of the transcript. Decoding the directory name is
 * lossy — "vp-github/DevChat" and "vp/github/DevChat" encode identically.
 */
async function readHeader(
  file: string,
  maxLines = 80,
): Promise<{
  cwd: string | null;
  title: string | null;
  gitBranch: string | null;
  lastPrompt: string | null;
}> {
  const result = {
    cwd: null as string | null,
    title: null as string | null,
    gitBranch: null as string | null,
    lastPrompt: null as string | null,
  };
  let buf = "";
  try {
    // Only the head of the file is needed; transcripts run to many MB.
    const stream = createReadStream(file, { encoding: "utf-8", end: 256 * 1024 });
    for await (const chunk of stream) buf += chunk;
  } catch {
    return result;
  }
  const lines = buf.split("\n").slice(0, maxLines);
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // truncated final line
    }
    if (!result.title && rec.type === "ai-title" && rec.aiTitle) result.title = rec.aiTitle;
    if (!result.lastPrompt && rec.type === "last-prompt" && rec.lastPrompt) {
      result.lastPrompt = String(rec.lastPrompt).slice(0, 300);
    }
    if (!result.cwd && rec.cwd) result.cwd = rec.cwd;
    if (!result.gitBranch && rec.gitBranch) result.gitBranch = rec.gitBranch;
    if (result.title && result.cwd && result.gitBranch && result.lastPrompt) break;
  }
  return result;
}

/** Count user/assistant records without holding the whole file in memory. */
async function countMessages(file: string): Promise<{ user: number; assistant: number }> {
  let user = 0;
  let assistant = 0;
  try {
    const content = await readFile(file, "utf-8");
    for (const line of content.split("\n")) {
      // Cheap prefix test before paying for JSON.parse.
      if (line.includes('"type":"user"')) user++;
      else if (line.includes('"type":"assistant"')) assistant++;
    }
  } catch {}
  return { user, assistant };
}

function sessionFiles(projectDir: string): string[] {
  try {
    return readdirSync(projectDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(projectDir, f));
  } catch {
    return [];
  }
}

/** Projects that have at least one transcript, newest first. */
export async function listProjects(): Promise<ClaudeProject[]> {
  if (!existsSync(PROJECTS_DIR)) return [];
  let entries: string[];
  try {
    entries = readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  const projects: ClaudeProject[] = [];
  for (const slug of entries) {
    const files = sessionFiles(join(PROJECTS_DIR, slug));
    if (files.length === 0) continue;

    let newest = files[0];
    let newestMs = 0;
    for (const f of files) {
      try {
        const ms = statSync(f).mtimeMs;
        if (ms > newestMs) {
          newestMs = ms;
          newest = f;
        }
      } catch {}
    }

    const { cwd } = await readHeader(newest);
    if (!cwd) continue; // no usable working directory -> not runnable

    projects.push({
      slug,
      cwd,
      sessionCount: files.length,
      lastActive: newestMs ? new Date(newestMs).toISOString() : null,
    });
  }

  projects.sort((a, b) => (b.lastActive || "").localeCompare(a.lastActive || ""));
  return projects;
}

/** Where runs are allowed — only folders Claude Code has already worked in. */
export async function runnableCwds(): Promise<Set<string>> {
  const projects = await listProjects();
  return new Set(projects.map((p) => p.cwd));
}

export async function isRunnableCwd(cwd: string): Promise<boolean> {
  return (await runnableCwds()).has(cwd);
}

/** Sessions for one project (or all projects when slug is omitted), newest first. */
export async function listSessions(opts: {
  projectSlug?: string;
  limit?: number;
}): Promise<ClaudeSession[]> {
  const limit = opts.limit ?? 50;
  const slugs = opts.projectSlug
    ? [opts.projectSlug]
    : (await listProjects()).map((p) => p.slug);

  const candidates: { file: string; slug: string; mtimeMs: number; size: number }[] = [];
  for (const slug of slugs) {
    for (const file of sessionFiles(join(PROJECTS_DIR, slug))) {
      try {
        const st = statSync(file);
        candidates.push({ file, slug, mtimeMs: st.mtimeMs, size: st.size });
      } catch {}
    }
  }

  // Sort before reading headers so only `limit` files are opened.
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const top = candidates.slice(0, limit);

  const sessions: ClaudeSession[] = [];
  for (const c of top) {
    const header = await readHeader(c.file);
    const counts = await countMessages(c.file);
    sessions.push({
      id: c.file.split("/").pop()!.replace(/\.jsonl$/, ""),
      projectSlug: c.slug,
      cwd: header.cwd,
      title: header.title,
      gitBranch: header.gitBranch,
      lastPrompt: header.lastPrompt,
      userMessages: counts.user,
      assistantMessages: counts.assistant,
      modified: new Date(c.mtimeMs).toISOString(),
      sizeBytes: c.size,
    });
  }
  return sessions;
}
