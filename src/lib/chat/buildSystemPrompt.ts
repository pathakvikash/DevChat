import { prisma } from "@/lib/db";
import { embed, scoreDocumentChunks, type ScoredChunk } from "@/lib/rag";
import { getMemoryBlock } from "@/lib/memory";
import { getCompressedContext } from "@/lib/compression";
import { TOOL_REGISTRY, getSkill } from "@/lib/registry";
import { extractText } from "@/lib/utils/messageParts";
import { BUILTIN_TOOL_IDS } from "./buildTools";
import { countTokens } from "@/lib/tokens";
import { getSettingsKey } from "@/lib/settings";

const VAS_TODO_SECTION = `TASK TRACKING — \`createTodos\` / \`createTodo\` / \`updateTodo\`
You MUST use todos for ANY request with multiple steps. Call \`createTodos\` ONCE at the start with ALL steps listed, then update each with \`updateTodo\` as you complete it. This gives the user real-time progress — they can see exactly what you're doing. \`createTodo\` (singular) is for adding one-off items mid-task. This is mandatory.`;

const VAS_SYSTEM_PROMPT_WITH_TOOLS_BASE = `You are VAS, an AI assistant with real tools. Use them — never claim you "cannot".

WEB SEARCH — \`webSearch({ query })\`
Call for real-time or current data — news, prices, recent events, anything beyond your training. Returns top 5 results with title, URL, snippet. Cite URLs in your answer.

CODE EXECUTION — \`executeCode({ language: "python"|"javascript", code })\`
Whenever code needs to run, EXECUTE it yourself — never just print it in markdown. Use \`print()\` (Python) or \`console.log()\` (JS) for visible output or the tool returns "(no output)". After the tool returns, read the result and explain it. Prefer Python.

FILE ATTACHMENTS
Attached file contents appear between markers in your messages. Images are image parts. Read them — don't ask the user to paste.

CRITICAL RULES — Tool Call Completion
1. After EVERY tool call, you MUST continue writing your answer. A tool call is the MIDDLE of your turn, never the end.
2. Never end your turn with a tool call or trail off with "Based on the results..." or "Here's what I found...". Instead, analyze the result immediately and deliver your full conclusion.
3. Never say "I'll wait for the result" or "Let me see what I find" — the result is already available.
4. If web search returns no useful results, state that clearly and answer from your own knowledge.
5. You may call \`webSearch\` at most 2 times per turn, then stop and write your full answer.`;

const VAS_CLARIFICATION_SECTION = `CLARIFICATION — \`askClarification({ question, type, options?, recommended? })\`
If the request is even slightly ambiguous, call this BEFORE any other tool. Ask one question at a time. Prefer \`type: "single"\` or \`type: "multi"\` (with options) over free-form text. For \`"single"\`, mark a \`recommended\` option that preserves the user's likely intent. Err on the side of asking — don't guess. If you have enough info to proceed confidently, do so.`;

const VAS_KB_SECTION = `KNOWLEDGE BASE — \`searchKnowledgeBase({ query, topK })\`
You have two data sources: (a) this tool for on-demand queries returning \`[source: filename#chunkN | score=X.XXX]\` excerpts, and (b) an auto-injected KB context block later in this prompt with top chunks already matched to the latest message. Call this tool when the user asks about their documents, says "find in the docs", or asks a domain question the KB likely covers. If it returns "No knowledge base attached", ask them to pick a KB in Model Settings.`;

const VAS_SYSTEM_PROMPT_CHAT_ONLY = `You are VAS (chat-only, no tools). You can answer questions, write code in markdown blocks, analyze file attachments, and use KB context if attached. You cannot execute code or search the web.`;

export interface BuildSystemPromptOptions {
  useTools: boolean;
  systemPrompt?: string;
  skillIds: string[];
  activeToolIds: Set<string>;
  conversationId?: string;
  kbId?: string;
  ragContext?: string;
  messages: unknown[];
  memoryDisabled?: boolean;
  userId: string;
}

/** Individual sections of the system prompt, exposed for the Context panel
 *  so it can show token usage per category (base prompt, persona, skills,
 *  tools, memory, compressed history, KB auto-inject). All values are
 *  `null` when the section wasn't generated. */
export interface SystemPromptSections {
  base: string;
  instructions: string | null;
  persona: string | null;
  skills: string | null;
  tools: string | null;
  memory: string | null;
  compressed: string | null;
  kb: string | null;
}

export interface BuildSystemPromptResult {
  text: string;
  sections: SystemPromptSections;
}

export async function buildSystemPrompt(
  opts: BuildSystemPromptOptions,
): Promise<BuildSystemPromptResult> {
  const {
    useTools,
    systemPrompt,
    skillIds,
    activeToolIds,
    conversationId,
    kbId,
    ragContext,
    messages,
  } = opts;

  const hasKbTool = useTools && activeToolIds.has("searchKnowledgeBase");
  const hasClarification = useTools && activeToolIds.has("askClarification");

  const baseSections = [VAS_SYSTEM_PROMPT_WITH_TOOLS_BASE, VAS_TODO_SECTION];
  if (hasClarification) baseSections.push(VAS_CLARIFICATION_SECTION);
  if (hasKbTool) baseSections.push(VAS_KB_SECTION);
  const base = useTools ? baseSections.join("\n\n") : VAS_SYSTEM_PROMPT_CHAT_ONLY;

  const customInstructions = await getSettingsKey(opts.userId, "customInstructions");
  const instructions =
    customInstructions && customInstructions.trim()
      ? `--- Instructions for DevChat ---\n${customInstructions}`
      : null;

  const persona =
    systemPrompt && systemPrompt.trim()
      ? `--- Persona / Custom Instructions ---\n${systemPrompt}`
      : null;

  const activeSkills = skillIds
    .map((sid) => getSkill(sid))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  const skills =
    activeSkills.length > 0
      ? `--- Active Skills ---\n${activeSkills
          .map((s) => `### Skill: ${s.name}\n${s.systemPrompt}`)
          .join("\n\n")}`
      : null;

  const extraToolNames = [...activeToolIds].filter(
    (id) => !(BUILTIN_TOOL_IDS as readonly string[]).includes(id),
  );
  const tools =
    extraToolNames.length > 0
      ? `--- Additional Tools Available ---\n${extraToolNames
          .map((id) => {
            const t = TOOL_REGISTRY[id];
            return t ? `- \`${id}\`: ${t.modelDescription}` : null;
          })
          .filter(Boolean)
          .join("\n")}`
      : null;

  const memoryRaw = opts.memoryDisabled ? null : await getMemoryBlock(opts.userId);
  const memory = memoryRaw ?? null;

  let compressed: string | null = null;
  if (conversationId) {
    const cs = await getCompressedContext(conversationId);
    if (cs) compressed = `--- Compressed Conversation History ---\n${cs}`;
  }

  const kb = await retrieveKbContext({ kbId, ragContext, messages });

  const sections: SystemPromptSections = { base, instructions, persona, skills, tools, memory, compressed, kb };
  const text = [base, instructions, persona, skills, tools, memory, compressed, kb]
    .filter((s): s is string => Boolean(s))
    .join("\n\n");

  return { text, sections };
}

/** Hard ceiling on the auto-injected KB block. ~1500 tokens is enough for
 *  3-4 dense chunks and stays well under 25% of an 8K context window. */
const KB_TOKEN_BUDGET = 1500;

async function retrieveKbContext({
  kbId,
  ragContext,
  messages,
}: {
  kbId?: string;
  ragContext?: string;
  messages: unknown[];
}): Promise<string | null> {
  if (!messages || messages.length === 0) return null;
  if (kbId) {
    try {
      const lastUserMessage = extractText(messages[messages.length - 1] as any);
      if (!lastUserMessage) return null;
      const queryEmbedding = await embed(lastUserMessage);
      const documents = await prisma.document.findMany({
        where: { kbId },
        select: { id: true, filename: true, chunks: true },
      });

      const scored: ScoredChunk[] = [];
      documents.forEach((doc) => {
        try {
          scored.push(...scoreDocumentChunks(doc, queryEmbedding));
        } catch {
          // Skip documents with malformed chunk data.
        }
      });

      if (scored.length === 0) return null;

      const sorted = scored.sort((a, b) => b.score - a.score);

      // Take chunks in score order until we run out of token budget. Each
      // chunk also pays a small fixed overhead for the citation header and
      // the "---" separator between chunks.
      const selected: typeof sorted = [];
      let usedTokens = 0;
      const perChunkOverhead = countTokens("[source: filename#chunkN | score=0.000]\n\n---\n\n");
      for (const c of sorted) {
        const chunkTokens = countTokens(c.text) + perChunkOverhead;
        if (usedTokens + chunkTokens > KB_TOKEN_BUDGET) continue;
        selected.push(c);
        usedTokens += chunkTokens;
      }

      if (selected.length === 0) {
        return "Context from knowledge base: (no chunks fit within the token budget — call \`searchKnowledgeBase\` to retrieve specific excerpts)";
      }

      const body = selected
        .map(
          (c) =>
            `[source: ${c.source} | score=${c.score.toFixed(3)}]\n${c.text}`,
        )
        .join("\n\n---\n\n");

      const header =
        `Context from knowledge base (auto-injected — top ${selected.length} ` +
        `chunks, ~${usedTokens} of ${KB_TOKEN_BUDGET} token budget):`;
      return `${header}\n${body}`;
    } catch (error) {
      console.error("Error retrieving KB context:", error);
      return null;
    }
  }
  return ragContext ?? null;
}
