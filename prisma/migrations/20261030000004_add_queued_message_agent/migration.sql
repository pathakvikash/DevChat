-- Agent messages queued behind a busy chat: JSON of the sender (null for the user's own message).
ALTER TABLE "QueuedMessage" ADD COLUMN "agent" TEXT;
