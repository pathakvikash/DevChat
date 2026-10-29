import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { getModel } from "@/lib/models";
import { resolveProviderCreds } from "@/lib/apiKeys";
import { requireUserId } from "@/lib/auth";

export async function GET() {
  try {
    const userId = await requireUserId();
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const conversations = await prisma.conversation.findMany({
      where: { userId, createdAt: { gte: ninetyDaysAgo } },
      include: { messages: true },
      take: 500,
      orderBy: { createdAt: "desc" },
    });

    const stats = {
      // Side chats and sub-agent runs count in tokens and cost, not as conversations.
      totalConversations: conversations.filter((c) => !c.parentId).length,
      totalMessages: conversations.reduce((sum, c) => sum + c.messages.length, 0),
      totalTokens: conversations.reduce((sum, c) => sum + c.totalTokens, 0),
      modelUsage: {} as Record<string, number>,
      estimatedCost: 0,
    };

    // Calculate model usage and costs
    const creds = await resolveProviderCreds(userId);
    for (const conv of conversations) {
      if (!stats.modelUsage[conv.model]) {
        stats.modelUsage[conv.model] = 0;
      }
      stats.modelUsage[conv.model] += conv.totalTokens;

      // Estimate cost
      try {
        const modelConfig = getModel(conv.model, creds);
        const messages = conv.messages;
        const inputTokens = messages.reduce((sum, m) => sum + m.inputTokens, 0);
        const outputTokens = messages.reduce((sum, m) => sum + m.outputTokens, 0);

        const cost =
          (inputTokens / 1000) * modelConfig.costPer1kInputTokens +
          (outputTokens / 1000) * modelConfig.costPer1kOutputTokens;

        stats.estimatedCost += cost;
      } catch {
        // Model not found, skip cost calculation
      }
    }

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Failed to fetch analytics:", error);
    return NextResponse.json({ error: "Failed to fetch analytics" }, { status: 500 });
  }
}
