import { lstatSync, realpathSync } from "fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "path";

/** Folders whose files run code or change what Claude Code may do: an edit there always asks. */
const GUARDED = new Set([".git", ".claude"]);

/** True when the file an Edit/Write/MultiEdit/NotebookEdit names is inside `cwd` once symlinks are followed,
 *  and not under `.git/` or `.claude/`. A file that does not exist yet is judged by its parent folder. */
export function editInsideCwd(cwd: string, input: unknown): boolean {
  const i = (input ?? {}) as { file_path?: unknown; notebook_path?: unknown };
  const file = i.file_path ?? i.notebook_path;
  if (typeof file !== "string" || !file) return false;
  try {
    const root = realpathSync(cwd);
    const target = resolve(cwd, file);
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
