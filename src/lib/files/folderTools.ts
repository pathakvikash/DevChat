import { tool, type Tool } from "ai";
import { realpath, stat } from "fs/promises";
import { isAbsolute, relative, resolve, sep } from "path";
import { z } from "zod";
import { budgetTokens } from "@/lib/chat/contextBudget";
import { quotePastChat, titleForHeader } from "@/lib/chat/quotePastChat";
import { cutTokens } from "@/lib/tokens";
import { listFolderFiles, readInside, resolveInside } from "./safePath";

const LIST_MAX = 300;
const READ_MAX_LINES = 2000;
const READ_LINE_CHARS = 500;
const SEARCH_MAX_MATCHES = 50;
const SEARCH_LINE_CHARS = 200;
const SEARCH_FILE_BYTES = 256 * 1024;
const LIST_CUT_NOTE = "Listing cut at 5,000 files; pass path to look at a subfolder.";

/** What stops a searchFiles scan; the defaults are the real limits, tests pass small ones. */
export interface SearchLimits {
  maxFiles: number;
  maxBytes: number;
  maxMs: number;
}
const SEARCH_LIMITS: SearchLimits = { maxFiles: 2000, maxBytes: 20 * 1024 * 1024, maxMs: 5000 };

const noFile = (path: string) =>
  new Error(
    `No readable file at "${titleForHeader(path)}". Paths are relative to the working folder; hidden and secret files can't be read. Use listFiles to see what is there.`,
  );

/** "" for the folder root, else the resolved folder's path inside it (`sub/dir`); throws unless it is a readable folder. */
async function folderSub(folder: string, path?: string): Promise<string> {
  if (!path || path === ".") return "";
  // "src/.." names the root itself, which resolveInside (files only) refuses.
  const root = await realpath(folder).catch(() => null);
  if (root && !isAbsolute(path) && !path.includes("\0") && (await realpath(resolve(root, path)).catch(() => null)) === root) return "";
  const real = await resolveInside(folder, path);
  if (!real || !(await stat(real).then((s) => s.isDirectory(), () => false))) {
    throw new Error(`No readable folder at "${titleForHeader(path)}".`);
  }
  // From the resolved path, so a symlinked or differently-cased name lists the files it really holds.
  return relative(await realpath(folder), real).split(sep).join("/");
}

export const FOLDER_TOOL_NAMES = ["listFiles", "readFile", "searchFiles"];
const FOLDER_TOOL_PART = new RegExp(`^tool-(${FOLDER_TOOL_NAMES.join("|")})$`);

/** True when a chat's messages hold a call of a folder tool: file text is in its history, so it stays gated. */
export function hasFolderToolParts(messages: unknown): boolean {
  return (
    Array.isArray(messages) &&
    messages.some((m) => Array.isArray(m?.parts) && m.parts.some((p: { type?: unknown }) => typeof p?.type === "string" && FOLDER_TOOL_PART.test(p.type)))
  );
}

/** Read-only tools over a working folder for models without their own file access. Every path goes through safePath. */
export function folderTools(folder: string, contextWindow: number, limits: SearchLimits = SEARCH_LIMITS): Record<string, Tool> {
  const pathField = z.string().max(1000).optional().describe("A subfolder of the working folder; the whole folder by default.");

  return {
    listFiles: tool({
      description:
        "List the files in the working folder (or a subfolder) with their sizes. Read-only. Hidden and secret files are not shown.",
      inputSchema: z.object({ path: pathField }),
      execute: async ({ path }) => {
        const sub = await folderSub(folder, path);
        const { files, truncated } = await listFolderFiles(folder, undefined, sub);
        const lines = files.slice(0, LIST_MAX).map((f) => `${f.path} (${Math.ceil(f.size / 1024)} KB)`);
        let body = lines.join("\n") || "No files.";
        body = cutTokens(body, budgetTokens(contextWindow, 0.1, 4000));
        if (files.length > LIST_MAX) body += `\nShowing ${LIST_MAX} of ${files.length} files; pass path to list a subfolder.`;
        if (truncated) body += `\n${LIST_CUT_NOTE}`;
        return quotePastChat(`the working-folder listing of "${titleForHeader(sub || ".")}"`, body);
      },
    }),

    readFile: tool({
      description:
        "Read a text file from the working folder, up to 2000 lines at a time, with line numbers. Pass startLine to continue a long file. Read-only. Hidden and secret files can't be read.",
      inputSchema: z.object({
        path: z.string().min(1).max(1000).describe("File path relative to the working folder."),
        startLine: z.number().int().min(1).optional().describe("First line to return (default 1)."),
      }),
      execute: async ({ path, startLine = 1 }) => {
        const file = await readInside(folder, path);
        if (!file.ok) {
          if (file.reason === "too-large") throw new Error(`"${titleForHeader(path)}" is larger than 1 MB; use searchFiles to find the part you need.`);
          if (file.reason === "binary") throw new Error(`"${titleForHeader(path)}" is a binary file.`);
          throw noFile(path);
        }
        const all = file.text.split(/\r?\n/);
        if (all.length > 1 && all[all.length - 1] === "") all.pop();
        if (startLine > all.length) throw new Error(`"${titleForHeader(path)}" has only ${all.length} lines.`);
        const numbered = all
          .slice(startLine - 1, startLine - 1 + READ_MAX_LINES)
          .map((line, i) => `${startLine + i}| ${line.length > READ_LINE_CHARS ? `${line.slice(0, READ_LINE_CHARS)}…` : line}`);
        let shown = numbered.join("\n");
        const cut = cutTokens(shown, budgetTokens(contextWindow, 0.15, 8000));
        if (cut !== shown) {
          // Keep whole lines only, so "More" says exactly where to continue. A first line over the budget
          // is kept cut, so paging still advances.
          const end = cut.lastIndexOf("\n");
          shown = end < 0 ? cut || `${startLine}| …cut…` : cut.slice(0, end);
          numbered.length = end < 0 ? 1 : shown.split("\n").length;
        }
        const last = startLine - 1 + numbered.length;
        const more = last < all.length ? `\nMore: call readFile with startLine ${last + 1}.` : "";
        return quotePastChat(
          `working-folder file "${titleForHeader(path)}", lines ${startLine}-${last} of ${all.length}`,
          shown + more,
        );
      },
    }),

    // ponytail: linear Node scan, stops at 2,000 files / 20 MB / 5 s; spawn ripgrep when present, or keep an index, if big repos need full coverage
    searchFiles: tool({
      description:
        "Search the working folder's text files for a literal, case-insensitive string. Returns path:line: text for up to 50 matches. Read-only. Hidden, secret, binary and large files are skipped.",
      inputSchema: z.object({
        query: z.string().min(2).max(200).describe("Text to find (not a regex)."),
        path: pathField,
      }),
      execute: async ({ query, path }, { abortSignal }) => {
        const sub = await folderSub(folder, path);
        const needle = query.toLowerCase();
        const { files, truncated } = await listFolderFiles(folder, undefined, sub);
        const matches: string[] = [];
        const started = Date.now();
        let scanned = 0;
        let bytes = 0;
        let stopped = "";
        for (const f of files) {
          if (f.size === 0 || f.size > SEARCH_FILE_BYTES) continue;
          if (abortSignal?.aborted) break;
          if (matches.length >= SEARCH_MAX_MATCHES) stopped = `${SEARCH_MAX_MATCHES} matches`;
          else if (scanned >= limits.maxFiles) stopped = `${limits.maxFiles} files`;
          else if (bytes >= limits.maxBytes) stopped = `${+(limits.maxBytes / 1024 / 1024).toFixed(1)} MB`;
          else if (Date.now() - started >= limits.maxMs) stopped = `${+(limits.maxMs / 1000).toFixed(1)} seconds`;
          if (stopped) break;
          scanned++;
          bytes += f.size;
          const file = await readInside(folder, f.path, SEARCH_FILE_BYTES);
          if (!file.ok) continue;
          const lines = file.text.split(/\r?\n/);
          for (let i = 0; i < lines.length && matches.length < SEARCH_MAX_MATCHES; i++) {
            if (lines[i].toLowerCase().includes(needle)) matches.push(`${f.path}:${i + 1}: ${lines[i].trim().slice(0, SEARCH_LINE_CHARS)}`);
          }
        }
        // The last file can fill the list.
        if (!stopped && matches.length >= SEARCH_MAX_MATCHES) stopped = `${SEARCH_MAX_MATCHES} matches`;
        const cancelled = abortSignal?.aborted;
        let body = matches.length
          ? cutTokens(matches.join("\n"), budgetTokens(contextWindow, 0.1, 4000))
          : cancelled ? "" : `No matches for "${titleForHeader(query)}".`;
        if (cancelled) body += `${body ? "\n" : ""}Search cancelled.`;
        else if (stopped) body += `\nStopped after ${stopped}; narrow the query or pass path.`;
        if (truncated) body += `\n${LIST_CUT_NOTE}`;
        return quotePastChat(`working-folder matches for "${titleForHeader(query)}"`, body);
      },
    }),
  };
}
