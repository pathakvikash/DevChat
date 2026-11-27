import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser } from "@/lib/workflows/http";
import { dropParkedRuns } from "@/lib/cliProviders";
import { disconnectFromServer } from "@/lib/mcp/client";

/** Wipes everything the user made. Keeps the User, Account, sessions and AppSetting rows (sign-in, API keys, preferences).
 *  Child rows (messages, documents, chunks, tool calls, run rows, table rows) go with their parent by cascade.
 *  Live resources are released first, as the single-delete routes do: parked CLI runs and MCP connections.
 *  A running workflow needs nothing: the runner stops itself when its next save finds the run row gone. */
export async function DELETE() {
  return withUser(async (userId) => {
    const where = { userId };
    const [chats, servers] = await Promise.all([
      prisma.conversation.findMany({ where, select: { id: true } }),
      prisma.mcpServer.findMany({ where, select: { id: true } }),
    ]);
    for (const c of chats) dropParkedRuns(c.id);
    await Promise.all(servers.map((s) => disconnectFromServer(s.id).catch(() => {})));
    await prisma.$transaction([
      prisma.workflowRun.deleteMany({ where }),
      prisma.workflow.deleteMany({ where }),
      prisma.dataTable.deleteMany({ where }),
      prisma.trace.deleteMany({ where }),
      prisma.conversation.deleteMany({ where }),
      prisma.memory.deleteMany({ where }),
      prisma.knowledgeBase.deleteMany({ where }),
      prisma.persona.deleteMany({ where }),
      prisma.mcpServer.deleteMany({ where }),
    ]);
    return NextResponse.json({ success: true });
  });
}
