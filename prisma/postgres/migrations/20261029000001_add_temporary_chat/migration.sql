-- Temporary chats: hidden from lists, memory off, deleted on leave or after 24h.
ALTER TABLE "Conversation" ADD COLUMN     "temporary" BOOLEAN NOT NULL DEFAULT false;
