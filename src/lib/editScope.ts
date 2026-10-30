import { lstatSync, realpathSync } from "fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "path";

/** Folders whose files run code or change what Claude Code may do: an edit there always asks. */
const GUARDED = new Set([".git", ".claude", ".husky", ".githooks"]);

/** The input key that names the file, by tool: a notebook has its own, and no other key stands in for it. */
const PATH_KEY = new Map([["Edit", "file_path"], ["Write", "file_path"], ["MultiEdit", "file_path"], ["NotebookEdit", "notebook_path"]]);

/** True when the file an Edit/Write/MultiEdit/NotebookEdit names, as an absolute path, is inside `cwd` once symlinks
 *  are followed, and not under a guarded folder. A file that does not exist yet is judged by its parent folder.
 *  A relative path (`~/.zshrc` too: the shell expands it, Claude Code does not) never qualifies. */
export function editInsideCwd(cwd: string, toolName: string, input: unknown): boolean {
  const key = PATH_KEY.get(toolName);
  const file = key ? (input as Record<string, unknown> | null)?.[key] : undefined;
  if (typeof file !== "string" || !isAbsolute(file)) return false;
  try {
    const root = realpathSync(cwd);
    const target = resolve(file);
    let real: string;
    try {
      real = realpathSync(target);
    } catch {
      // It exists but cannot be resolved: a dangling symlink, which a write would follow out of the folder.
      try {
        lstatSync(target);
        return false;
      } catch {
        real = join(realpathSync(dirname(target)), basename(target));
      }
    }
    const rel = relative(root, real);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
    // Lower-cased: macOS and Windows folders ignore case, so `.GIT/hooks` is `.git/hooks`.
    return !rel.split(sep).some((seg) => GUARDED.has(seg.toLowerCase()));
  } catch {
    return false;
  }
}
