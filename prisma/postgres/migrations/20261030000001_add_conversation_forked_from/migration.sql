-- Fork from here: the copy remembers its source; deleting the source keeps the copy.
ALTER TABLE "Conversation" ADD COLUMN     "forkedFromId" TEXT;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_forkedFromId_fkey" FOREIGN KEY ("forkedFromId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
