-- Fork from here: the copy remembers its source; deleting the source keeps the copy.
ALTER TABLE "Conversation" ADD COLUMN "forkedFromId" TEXT REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
