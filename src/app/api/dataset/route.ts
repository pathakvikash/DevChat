import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";

interface ShareGPTMessage {
  from: "human" | "gpt" | "system" | "tool";
  value: string;
}

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const url = new URL(req.url);
    const format = url.searchParams.get("format") || "sharegpt";
    const minRating = url.searchParams.get("minRating");
    const model = url.searchParams.get("model");
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "1000", 10),
      10000,
    );

    const where: Record<string, unknown> = {
      role: "assistant",
      conversation: { userId },
    };
    if (minRating) {
      where.feedback = { is: { rating: { gte: parseInt(minRating, 10) } } };
    } else {
      where.feedback = { isNot: null };
    }
    if (model) {
      where.model = model;
    }

    const assistantMessages = await prisma.message.findMany({
      where: where as any,
      include: {
        feedback: true,
        conversation: {
          select: { id: true, systemPrompt: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const conversationIds = [
      ...new Set(assistantMessages.map((m) => m.conversationId)),
    ];
    const userMessages = await prisma.message.findMany({
      where: {
        conversationId: { in: conversationIds },
        role: "user",
      },
      select: {
        id: true,
        conversationId: true,
        content: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const userMsgByConv = new Map<string, string[]>();
    for (const um of userMessages) {
      const list = userMsgByConv.get(um.conversationId) || [];
      list.push(um.content);
      userMsgByConv.set(um.conversationId, list);
    }

    const isShareGPT = format === "sharegpt";
    const lines: string[] = [];

    for (const msg of assistantMessages) {
      const parts = parseParts(msg.parts);
      const toolCalls = parts.filter(
        (p: any) => p.state === "output-available",
      );
      const toolResults = parts.filter((p: any) => p.state === "result");
      const userMsgs = userMsgByConv.get(msg.conversationId) || [];
      const precedingUser = userMsgs[userMsgs.length - 1] || "";
      // Only include the user-set system prompt from that session's model
      // settings — not the fully built prompt (RAG/memory/tools injected at
      // request time), which is stored on msg.systemPrompt.
      const systemPrompt = msg.conversation.systemPrompt || "";

      if (isShareGPT) {
        const conversations: ShareGPTMessage[] = [];
        if (systemPrompt) {
          conversations.push({ from: "system", value: systemPrompt });
        }
        if (precedingUser) {
          conversations.push({ from: "human", value: precedingUser });
        }

        let assistantValue = msg.content;
        if (toolCalls.length > 0) {
          const toolSection = toolCalls
            .map(
              (t: any) =>
                `[Tool: ${t.toolName}]\nInput: ${JSON.stringify(t.input)}\nOutput: ${
                  toolResults.find(
                    (r: any) => r.toolCallId === t.toolCallId,
                  )?.output ?? "(pending)"
                }`,
            )
            .join("\n\n");
          assistantValue = `${toolSection}\n\n${assistantValue}`;
        }
        conversations.push({ from: "gpt", value: assistantValue });

        lines.push(
          JSON.stringify({
            conversations,
            model: msg.model ?? undefined,
            source: "vas",
            score: msg.feedback?.rating === 1 ? 1 : 0,
          }),
        );
      } else {
        const entry: Record<string, unknown> = {
          instruction: precedingUser,
          response: msg.content,
          system_prompt: systemPrompt,
          model: msg.model,
          rating: msg.feedback?.rating,
          has_tool_calls: toolCalls.length > 0,
        };
        if (toolCalls.length > 0) {
          entry.tool_calls = toolCalls.map((t: any) => ({
            tool: t.toolName,
            input: t.input,
          }));
          entry.tool_results = toolResults.map((t: any) => ({
            tool: t.toolName,
            output: t.output,
          }));
        }
        lines.push(JSON.stringify(entry));
      }
    }

    const ext = isShareGPT ? ".json" : ".jsonl";
    const contentType = isShareGPT
      ? "application/json"
      : "application/x-jsonlines";

    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename=vas-dataset${ext}`,
      },
    });
  } catch (error) {
    console.error("Dataset export error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to export dataset" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

function parseParts(parts: string | null): any[] {
  if (!parts) return [];
  try {
    return JSON.parse(parts);
  } catch {
    return [];
  }
}