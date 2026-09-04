import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { requireUserId } from "@/lib/auth";
import { getConversationOrNull } from "@/lib/api/conversations";
import { resolveModel } from "@/lib/llm";

/** One suggested next user message. The client sends the last exchange so this
 *  doesn't race persistence of the assistant message. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const conversation = await getConversationOrNull(id, userId);
    if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const user = typeof body.user === "string" ? body.user.slice(0, 4000) : "";
    const assistant = typeof body.assistant === "string" ? body.assistant.slice(0, 6000) : "";
    if (!assistant) return NextResponse.json({ suggestion: null });

    const cfg = await resolveModel(conversation.model, userId);
    const { text } = await generateText({
      model: cfg.model,
      system:
        "You write the user's likely next message in a chat. Reply with ONE short follow-up request or question the user would plausibly send next, in the user's voice, under 12 words, no quotes, no trailing punctuation. If nothing useful follows, reply with NONE.",
      prompt: `User: ${user}\n\nAssistant: ${assistant}`,
      temperature: 0.7,
      maxOutputTokens: 40,
    });
    // Models like to answer with `- "Show me the code."` or `**Show me…**`
    // even when told not to; strip the wrapping rather than show it greyed.
    const suggestion = text
      .trim()
      .split("\n")[0]
      .replace(/^[-*>\s]+/, "")
      .replace(/^[`"'*_“”]+|[`"'*_.“”]+$/g, "")
      .trim();
    if (!suggestion || /^none$/i.test(suggestion) || suggestion.length > 140) {
      return NextResponse.json({ suggestion: null });
    }
    return NextResponse.json({ suggestion });
  } catch (error) {
    console.warn("[suggest] failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ suggestion: null });
  }
}
