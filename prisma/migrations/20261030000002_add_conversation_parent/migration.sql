-- Child conversations (side chats, sub-agent runs): hidden from lists, deleted with their parent.
ALTER TABLE "Conversation" ADD COLUMN "parentId" TEXT REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'main';
CREATE INDEX "Conversation_parentId_idx" ON "Conversation"("parentId");
