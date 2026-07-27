import hljs from "highlight.js";

/**
 * Aliases / fence tags frequently emitted by LLMs that aren't 1:1 with the
 * `highlight.js` language registry. The right side of the map MUST be a
 * language string `hljs.getLanguage()` accepts, otherwise we fall back to
 * plain text (empty language string) and let hljs safely escape HTML.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  javascript: "javascript",
  jsx: "javascript",
  ts: "typescript",
  typescript: "typescript",
  tsx: "typescript",
  py: "python",
  python: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  rust: "rust",
  java: "java",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  csharp: "csharp",
  cs: "csharp",
  php: "php",
  ruby: "ruby",
  kotlin: "kotlin",
  kt: "kotlin",
  swift: "swift",
  scala: "scala",
  sql: "sql",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yaml: "yaml",
  yml: "yaml",
  json: "json",
  xml: "xml",
  html: "xml",
  css: "css",
  scss: "scss",
  markdown: "markdown",
  md: "markdown",
  dockerfile: "dockerfile",
  makefile: "makefile",
  toml: "ini",
  ini: "ini",
  diff: "diff",
  graphql: "graphql",
};

/**
 * Returns a language name that `hljs.highlight` will accept, or "" for
 * "no highlighting" (safe, never throws). Pass-through the input as
 * lowercase; resolve aliases; verify the name is actually registered
 * before returning it.
 */
export function resolveLanguage(input: string): string {
  const normalized = (input || "").toLowerCase().trim();
  if (!normalized) return "";
  const aliased = LANGUAGE_ALIASES[normalized] ?? normalized;
  return hljs.getLanguage(aliased) ? aliased : "";
}

/**
 * Highlight `code` as `language`. Never throws on unknown languages —
 * unknown / empty / "plain" / "mark" etc. fall back to plain text
 * (hljs will still HTML-escape).
 *
 * Use this in place of calling `hljs.highlight(...)` directly anywhere
 * in the UI, so model-emitted fence tags we haven't taught highlight.js
 * about can't crash the renderer.
 */
export function highlightCode(code: string, language: string): string {
  const resolved = resolveLanguage(language);
  if (!resolved) {
    return hljs.highlightAuto(code).value;
  }
  return hljs.highlight(code, {
    language: resolved,
    ignoreIllegals: true,
  }).value;
}
