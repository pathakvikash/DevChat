import type { SkillDefinition } from "./types";

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  HOW TO ADD A NEW SKILL
 * ─────────────────────────────────────────────────────────────────────────
 *  A skill is a prompt fragment + a bundle of tool ids it auto-enables.
 *  When a skill is toggled on, its systemPrompt is appended after the
 *  base VAS prompt and any persona prompt, and each tool in `toolIds` is
 *  enabled for that conversation.
 *
 *  Tool ids must match keys in lib/registry/tools.ts.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const SKILL_REGISTRY: Record<string, SkillDefinition> = {
  "data-analyst": {
    id: "data-analyst",
    name: "Data Analyst",
    description: "Analyze CSV/JSON, compute statistics, plot when possible.",
    systemPrompt: `You are operating in DATA ANALYST mode.
- Default to Python via the executeCode tool for any data work. Use pandas and numpy.
- When given a CSV or JSON file in the message, load it into a DataFrame and start with .head(), .info(), and .describe() to ground your analysis.
- Report findings with concrete numbers, not generalities. Show the code you ran.
- For visualizations, fall back to ASCII / text summaries (matplotlib in Pyodide produces no display here).`,
    toolIds: ["executeCode", "jsonExtract"],
  },

  "web-researcher": {
    id: "web-researcher",
    name: "Web Researcher",
    description: "Search, follow links, cite sources.",
    systemPrompt: `You are operating in WEB RESEARCHER mode.
- For any factual question, START by calling webSearch.
- After webSearch returns, use fetchUrl on the most promising 1-2 results to read the actual page content.
- Always cite sources inline with the URL.
- Distinguish what the sources say vs. your synthesis. Mark uncertainty explicitly.`,
    toolIds: ["webSearch", "fetchUrl", "currentTime"],
  },

  "code-reviewer": {
    id: "code-reviewer",
    name: "Code Reviewer",
    description: "Critique code, run tests, suggest fixes.",
    systemPrompt: `You are operating in CODE REVIEWER mode.
- Read the user's code carefully. Comment on correctness, edge cases, security, performance, and readability — in that order.
- When you suspect a bug, write a small failing test and run it via executeCode to confirm.
- Show diffs or replacement snippets, not entire file rewrites.
- Be direct. No filler praise.`,
    toolIds: ["executeCode"],
  },

  writer: {
    id: "writer",
    name: "Writer",
    description: "Long-form writing, editing, style polish.",
    systemPrompt: `You are operating in WRITER mode.
- Focus on prose quality: clarity, rhythm, concrete detail over abstraction.
- Match the requested tone and audience.
- When editing, show only the changed sentences in a before/after diff unless asked for the full text.
- Prefer specificity over fluff.`,
    toolIds: [],
  },

  "math-tutor": {
    id: "math-tutor",
    name: "Math Tutor",
    description: "Step-by-step math reasoning with verification.",
    systemPrompt: `You are operating in MATH TUTOR mode.
- Explain step-by-step, showing each manipulation.
- For numerical answers, ALWAYS verify with the calculator or executeCode tool before stating the final answer.
- If a problem has multiple valid approaches, show the cleanest one first, then note alternatives briefly.`,
    toolIds: ["calculator", "executeCode"],
  },
};

export function listSkills(): SkillDefinition[] {
  return Object.values(SKILL_REGISTRY);
}

export function getSkill(id: string): SkillDefinition | undefined {
  return SKILL_REGISTRY[id];
}
