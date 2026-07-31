-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" DATETIME,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AppSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AppSetting" ("id", "key", "updatedAt", "value") SELECT "id", "key", "updatedAt", "value" FROM "AppSetting";
DROP TABLE "AppSetting";
ALTER TABLE "new_AppSetting" RENAME TO "AppSetting";
CREATE UNIQUE INDEX "AppSetting_userId_key_key" ON "AppSetting"("userId", "key");
CREATE TABLE "new_Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
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
    "memoryDisabled" BOOLEAN NOT NULL DEFAULT false,
    "maxToolCalls" INTEGER NOT NULL DEFAULT 5,
    "fallbackModel" TEXT,
    "note" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Conversation" ("archived", "chatOnlyMode", "compressedAfterTokens", "compressedAt", "compressedBeforeMessages", "compressedBeforeTokens", "compressedSummary", "contextLength", "createdAt", "fallbackModel", "id", "kbId", "maxTokens", "maxToolCalls", "memoryDisabled", "model", "note", "persona", "pinned", "systemPrompt", "temperature", "title", "topP", "totalTokens", "updatedAt", "webSearch") SELECT "archived", "chatOnlyMode", "compressedAfterTokens", "compressedAt", "compressedBeforeMessages", "compressedBeforeTokens", "compressedSummary", "contextLength", "createdAt", "fallbackModel", "id", "kbId", "maxTokens", "maxToolCalls", "memoryDisabled", "model", "note", "persona", "pinned", "systemPrompt", "temperature", "title", "topP", "totalTokens", "updatedAt", "webSearch" FROM "Conversation";
DROP TABLE "Conversation";
ALTER TABLE "new_Conversation" RENAME TO "Conversation";
CREATE INDEX "Conversation_updatedAt_idx" ON "Conversation"("updatedAt");
CREATE INDEX "Conversation_userId_idx" ON "Conversation"("userId");
CREATE TABLE "new_KnowledgeBase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeBase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_KnowledgeBase" ("createdAt", "description", "id", "name", "updatedAt") SELECT "createdAt", "description", "id", "name", "updatedAt" FROM "KnowledgeBase";
DROP TABLE "KnowledgeBase";
ALTER TABLE "new_KnowledgeBase" RENAME TO "KnowledgeBase";
CREATE INDEX "KnowledgeBase_userId_idx" ON "KnowledgeBase"("userId");
CREATE TABLE "new_McpServer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'none',
    "authConfig" TEXT,
    "authToken" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastPingAt" DATETIME,
    "errorMsg" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "McpServer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_McpServer" ("authConfig", "authToken", "authType", "createdAt", "enabled", "errorMsg", "id", "lastPingAt", "name", "updatedAt", "url") SELECT "authConfig", "authToken", "authType", "createdAt", "enabled", "errorMsg", "id", "lastPingAt", "name", "updatedAt", "url" FROM "McpServer";
DROP TABLE "McpServer";
ALTER TABLE "new_McpServer" RENAME TO "McpServer";
CREATE UNIQUE INDEX "McpServer_userId_name_key" ON "McpServer"("userId", "name");
CREATE TABLE "new_Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "confidence" REAL NOT NULL DEFAULT 0.6,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" DATETIME,
    "sourceConversationId" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Memory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Memory" ("category", "confidence", "createdAt", "id", "key", "lastUsedAt", "pinned", "sourceConversationId", "updatedAt", "useCount", "value") SELECT "category", "confidence", "createdAt", "id", "key", "lastUsedAt", "pinned", "sourceConversationId", "updatedAt", "useCount", "value" FROM "Memory";
DROP TABLE "Memory";
ALTER TABLE "new_Memory" RENAME TO "Memory";
CREATE INDEX "Memory_category_idx" ON "Memory"("category");
CREATE INDEX "Memory_userId_idx" ON "Memory"("userId");
CREATE UNIQUE INDEX "Memory_userId_key_key" ON "Memory"("userId", "key");
CREATE TABLE "new_Persona" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Persona_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Persona" ("createdAt", "description", "id", "isBuiltIn", "name", "systemPrompt") SELECT "createdAt", "description", "id", "isBuiltIn", "name", "systemPrompt" FROM "Persona";
DROP TABLE "Persona";
ALTER TABLE "new_Persona" RENAME TO "Persona";
CREATE UNIQUE INDEX "Persona_userId_name_key" ON "Persona"("userId", "name");
CREATE TABLE "new_Trace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "conversationId" TEXT,
    "model" TEXT NOT NULL,
    "provider" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "cost" REAL,
    "latencyMs" INTEGER NOT NULL,
    "firstTokenMs" INTEGER,
    "steps" INTEGER,
    "finishReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'success',
    "errorMsg" TEXT,
    "inputChars" INTEGER,
    "outputChars" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Trace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Trace" ("completionTokens", "conversationId", "cost", "createdAt", "errorMsg", "finishReason", "firstTokenMs", "id", "inputChars", "latencyMs", "model", "outputChars", "promptTokens", "provider", "status", "steps", "totalTokens") SELECT "completionTokens", "conversationId", "cost", "createdAt", "errorMsg", "finishReason", "firstTokenMs", "id", "inputChars", "latencyMs", "model", "outputChars", "promptTokens", "provider", "status", "steps", "totalTokens" FROM "Trace";
DROP TABLE "Trace";
ALTER TABLE "new_Trace" RENAME TO "Trace";
CREATE INDEX "Trace_createdAt_idx" ON "Trace"("createdAt");
CREATE INDEX "Trace_model_idx" ON "Trace"("model");
CREATE INDEX "Trace_status_idx" ON "Trace"("status");
CREATE INDEX "Trace_conversationId_idx" ON "Trace"("conversationId");
CREATE INDEX "Trace_userId_idx" ON "Trace"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");
