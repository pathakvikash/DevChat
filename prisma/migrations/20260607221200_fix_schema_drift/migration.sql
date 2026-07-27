-- AlterTable
ALTER TABLE "Message" ADD COLUMN "parts" TEXT;

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL DEFAULT 'New Chat',
    "model" TEXT NOT NULL DEFAULT 'gpt-4o',
    "persona" TEXT,
    "systemPrompt" TEXT,
    "kbId" TEXT,
    "webSearch" BOOLEAN NOT NULL DEFAULT false,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "temperature" REAL NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER,
    "contextLength" INTEGER,
    "topP" REAL,
    "compressedSummary" TEXT,
    "compressedAt" DATETIME,
    "compressedBeforeTokens" INTEGER,
    "compressedAfterTokens" INTEGER,
    "compressedBeforeMessages" INTEGER,
    "chatOnlyMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Conversation" ("createdAt", "id", "kbId", "maxTokens", "model", "persona", "systemPrompt", "temperature", "title", "totalTokens", "updatedAt", "webSearch") SELECT "createdAt", "id", "kbId", "maxTokens", "model", "persona", "systemPrompt", "temperature", "title", "totalTokens", "updatedAt", "webSearch" FROM "Conversation";
DROP TABLE "Conversation";
ALTER TABLE "new_Conversation" RENAME TO "Conversation";
CREATE INDEX "Conversation_updatedAt_idx" ON "Conversation"("updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Memory_key_key" ON "Memory"("key");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Persona_name_key" ON "Persona"("name");
