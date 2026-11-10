-- CreateTable
CREATE TABLE "QueuedMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "claimToken" TEXT,

    CONSTRAINT "QueuedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QueuedMessage_conversationId_deliveredAt_idx" ON "QueuedMessage"("conversationId", "deliveredAt");

-- AddForeignKey
ALTER TABLE "QueuedMessage" ADD CONSTRAINT "QueuedMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
