import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser } from "@/lib/workflows/http";

/** Wipes everything the user made. Keeps the User, Account, sessions and AppSetting rows (sign-in, API keys, preferences).
 *  Child rows (messages, documents, chunks, tool calls, run rows, table rows) go with their parent by cascade. */
export async function DELETE() {
  return withUser(async (userId) => {
    const where = { userId };
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
