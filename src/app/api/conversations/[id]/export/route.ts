import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

function getMessageText(msg: { content: string; parts: string | null }): string {
  if (msg.parts) {
    try {
      const parsed = JSON.parse(msg.parts);
      if (Array.isArray(parsed)) {
        // Message parts: extract text and show tool calls
        const lines: string[] = [];
        for (const p of parsed) {
          if (p.type === "text" && p.text) {
            lines.push(p.text);
          } else if (p.type === "tool-invocation") {
            const name = p.toolInvocation?.toolName || p.toolName || "tool";
            const input = p.toolInvocation?.args || p.args || p.toolInvocation?.input;
            const inputStr = input ? JSON.stringify(input, null, 2) : "";
            lines.push(`[Tool call: ${name}]${inputStr ? `\n\`\`\`json\n${inputStr}\n\`\`\`` : ""}`);
          } else if (p.type === "tool-result") {
            const name = p.toolInvocation?.toolName || p.toolName || "tool";
            const output = p.toolInvocation?.result || p.output || p.result;
            const outputStr = typeof output === "string" ? output : JSON.stringify(output, null, 2);
            lines.push(`[Tool result: ${name}]\n\`\`\`\n${outputStr}\n\`\`\``);
          } else if (p.type === "reasoning") {
            lines.push(`[Reasoning]\n${p.text || ""}`);
          }
        }
        if (lines.length > 0) return lines.join("\n\n");
      }
    } catch {
      // Fall through to content
    }
  }
  return msg.content || "";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const format = req.nextUrl.searchParams.get("format") || "markdown";

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const compressedAt = conversation.compressedAt
      ? new Date(conversation.compressedAt)
      : null;
    const messagesToExport = compressedAt
      ? conversation.messages.filter(
          (m) => new Date(m.createdAt) >= compressedAt,
        )
      : conversation.messages;

    let content = "";

    if (format === "json") {
      const exportPayload = {
        ...conversation,
        messages: messagesToExport,
        ...(compressedAt && conversation.compressedSummary
          ? {
              compressedSummary: conversation.compressedSummary,
              compressedAt: conversation.compressedAt,
            }
          : {}),
      };
      content = JSON.stringify(exportPayload, null, 2);
    } else {
      // Markdown format
      content = `# ${conversation.title}\n\n`;
      content += `**Model:** ${conversation.model}\n`;
      if (conversation.persona) {
        content += `**Persona:** ${conversation.persona}\n`;
      }
      content += `**Created:** ${conversation.createdAt.toISOString()}\n\n`;
      content += `---\n\n`;

      if (compressedAt && conversation.compressedSummary) {
        content += `### Compressed Summary\n\n${conversation.compressedSummary}\n\n`;
        content += `---\n\n`;
      }

      for (const msg of messagesToExport) {
        const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
        const text = getMessageText(msg);
        if (text) {
          content += `### ${role}\n\n${text}\n\n`;
        }
      }
    }

    const safeTitle = (conversation.title || "conversation").replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "conversation";
    const filename = `${safeTitle}.${format === "json" ? "json" : "md"}`;

    return new NextResponse(content, {
      headers: {
        "Content-Type": format === "json" ? "application/json" : "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Failed to export conversation:", error);
    return NextResponse.json({ error: "Failed to export conversation" }, { status: 500 });
  }
}
