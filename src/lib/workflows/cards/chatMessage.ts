import { prisma } from "@/lib/db";
import { buildAgentMessagePart } from "@/lib/chat/agentMessages";
import { getSettingsKey } from "@/lib/settings";
import { MESSAGE_MAX_CHARS } from "../catalog";
import { renderText } from "../template";
import type { CardImpl } from "./index";

export const chatMessageCard: CardImpl = {
  async run(c) {
    const { config, tctx, userId } = c;
    const rendered = renderText(String(config.message ?? ""), tctx);
    const warnings = rendered.missing.slice(0, 10).map((m) => `{{${m}}} was empty`);
    let message = rendered.text;
    if (message.length > MESSAGE_MAX_CHARS) {
      message = message.slice(0, MESSAGE_MAX_CHARS);
      warnings.push(`The message was cut to ${MESSAGE_MAX_CHARS.toLocaleString("en-US")} characters`);
    }
    if (!message.trim()) throw new Error("The message is empty");

    let conversationId: string;
    if (!config.chat || config.chat === "new") {
      const title = renderText(String(config.title ?? ""), tctx).text.replace(/\s+/g, " ").trim().slice(0, 120) || tctx.workflow.name;
      const model = c.defaultModel || (await getSettingsKey(userId, "defaultModel")) || undefined;
      const chat = await prisma.conversation.create({ data: { userId, title, model } });
      conversationId = chat.id;
    } else {
      const chat = await prisma.conversation.findFirst({ where: { id: String(config.chat), userId }, select: { id: true } });
      if (!chat) throw new Error("Chat not found");
      conversationId = chat.id;
    }

    const part = buildAgentMessagePart({ from: "workflow", fromConversationId: c.workflowId, fromTitle: tctx.workflow.name, hop: 1 });
    const row = await prisma.message.create({
      data: { conversationId, role: "user", content: message, parts: JSON.stringify([part, { type: "text", text: message }]) },
    });
    await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    return { output: { conversationId, messageId: row.id }, warnings };
  },
};
