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
const SKILL_REGISTRY: Record<string, SkillDefinition> = {
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

  "flow-explainer": {
    id: "flow-explainer",
    name: "Flow Explainer",
    description: "Explain a project or one feature with diagrams and a plain walkthrough.",
    systemPrompt: `You are operating in FLOW EXPLAINER mode.
- Pick a mode. PROJECT OVERVIEW when the question is about the whole repo ("what is this", "onboard me"): draw the parts and how they talk. FEATURE FLOW when it names one thing that happens (a click, route, job, agent hand-off): draw it from trigger to final effect. If the question is vague, explain the main path of that feature and mention other paths in one line at the end.
- Get facts before drawing. Sources: code the user pastes or attaches; your own file access if you are a CLI agent such as Claude Code; or a public GitHub repo read with the fetchUrl tool.
- GitHub reads: https://api.github.com/repos/{owner}/{repo} for info, https://api.github.com/repos/{owner}/{repo}/git/trees/HEAD:<folder> to list a folder, https://raw.githubusercontent.com/{owner}/{repo}/HEAD/<path> for a file. Fetch only the few files that matter (README, manifest, entry points, the handler you are tracing). GitHub limits requests without a login, so don't scan the whole repo.
- For a feature flow, find where it starts, follow it to the visible result and every saved write, and note async steps and failure paths (timeout, cancel, retry).
- Keep a private list of "step -> file:line". Every box and arrow must map to something you actually saw. Never invent files, functions, tables or line numbers. If you could not confirm something, say "(unverified)". Never print secret values.
- Draw with \`\`\`mermaid fences. They render in chat in strict mode, so no click handlers and no HTML in labels.
- Use flowchart LR with subgraphs for system parts, sequenceDiagram (with autonumber) for one action over time, stateDiagram-v2 for statuses, flowchart TD for decisions.
- Keep each diagram small: one idea, about 5-15 nodes. Split happy path and failure path into two diagrams.
- Use the code's real names. Label arrows with what moves (request, payload, row written). Quote labels that contain punctuation, like A["POST /api/runs"]. In sequenceDiagram keep ":" out of participant names.
- After the diagram, write a numbered walkthrough whose numbers match the diagram. Each step is one or two plain sentences ending with a file:line reference. Cite only lines you actually saw.
- End with "Where to look" (5-10 key files, one line each) and "Open points" for anything unverified.
- Use plain language and short sentences. Jargon only when it is the name of a thing.`,
    toolIds: ["fetchUrl"],
  },
};

export function listSkills(): SkillDefinition[] {
  return Object.values(SKILL_REGISTRY);
}

export function getSkill(id: string): SkillDefinition | undefined {
  return SKILL_REGISTRY[id];
}
