import type { WorkflowGraph } from "./graph";

/** "https://github.com/owner/name/tree/main", "git@github.com:owner/name.git" and "owner/name" all become "owner/name".
 *  Anything else comes back trimmed and unchanged. */
export function normalizeRepo(input: string): string {
  const s = input.trim();
  const m = /^(?:(?:https?:\/\/)?(?:www\.)?github\.com[/:]|git@github\.com:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(s);
  return m ? `${m[1]}/${m[2]}` : s;
}

/** The values `{{vars.key}}` reads. A variable with `format: "githubRepo"` (set by the Explain a GitHub repo template, never by a model) is read as owner/name. */
export const varValues = (vars: WorkflowGraph["vars"]): Record<string, string> =>
  Object.fromEntries(vars.map((v) => [v.key, v.format === "githubRepo" ? normalizeRepo(v.value) : v.value]));
