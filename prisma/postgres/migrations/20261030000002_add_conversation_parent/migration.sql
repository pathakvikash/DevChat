-- Child conversations (side chats, sub-agent runs): hidden from lists, deleted with their parent.
-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'main',
ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "Conversation_parentId_idx" ON "Conversation"("parentId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

