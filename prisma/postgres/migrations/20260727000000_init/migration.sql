-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New Chat',
    "model" TEXT NOT NULL DEFAULT 'gpt-4o',
    "persona" TEXT,
    "systemPrompt" TEXT,
    "kbId" TEXT,
    "webSearch" BOOLEAN NOT NULL DEFAULT false,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER,
    "contextLength" INTEGER,
    "topP" DOUBLE PRECISION,
    "compressedSummary" TEXT,
    "compressedAt" TIMESTAMP(3),
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "parts" TEXT,
    "attachments" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeBase" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "kbId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chunks" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "sourceConversationId" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalRun" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "model" TEXT NOT NULL,
    "maxCycles" INTEGER NOT NULL DEFAULT 10,
    "cyclesUsed" INTEGER NOT NULL DEFAULT 0,
    "tokenBudget" INTEGER NOT NULL DEFAULT 120000,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskItem" (
    "id" TEXT NOT NULL,
    "goalRunId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "order" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Todo" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Todo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpServer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'none',
    "authConfig" TEXT,
    "authToken" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastPingAt" TIMESTAMP(3),
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trace" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "model" TEXT NOT NULL,
    "provider" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "cost" DOUBLE PRECISION,
    "latencyMs" INTEGER NOT NULL,
    "firstTokenMs" INTEGER,
    "steps" INTEGER,
    "finishReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'success',
    "errorMsg" TEXT,
    "inputChars" INTEGER,
    "outputChars" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceToolCall" (
    "id" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "input" TEXT,
    "output" TEXT,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversation_updatedAt_idx" ON "Conversation"("updatedAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_messageId_key" ON "Feedback"("messageId");

-- CreateIndex
CREATE INDEX "Document_kbId_idx" ON "Document"("kbId");

-- CreateIndex
CREATE UNIQUE INDEX "Persona_name_key" ON "Persona"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Memory_key_key" ON "Memory"("key");

-- CreateIndex
CREATE INDEX "Memory_category_idx" ON "Memory"("category");

-- CreateIndex
CREATE INDEX "GoalRun_conversationId_idx" ON "GoalRun"("conversationId");

-- CreateIndex
CREATE INDEX "TaskItem_goalRunId_idx" ON "TaskItem"("goalRunId");

-- CreateIndex
CREATE INDEX "Todo_conversationId_idx" ON "Todo"("conversationId");

-- CreateIndex
CREATE INDEX "Todo_conversationId_status_idx" ON "Todo"("conversationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "McpServer_name_key" ON "McpServer"("name");

-- CreateIndex
CREATE INDEX "Artifact_conversationId_idx" ON "Artifact"("conversationId");

-- CreateIndex
CREATE INDEX "Trace_createdAt_idx" ON "Trace"("createdAt");

-- CreateIndex
CREATE INDEX "Trace_model_idx" ON "Trace"("model");

-- CreateIndex
CREATE INDEX "Trace_status_idx" ON "Trace"("status");

-- CreateIndex
CREATE INDEX "Trace_conversationId_idx" ON "Trace"("conversationId");

-- CreateIndex
CREATE INDEX "TraceToolCall_traceId_idx" ON "TraceToolCall"("traceId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_kbId_fkey" FOREIGN KEY ("kbId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalRun" ADD CONSTRAINT "GoalRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskItem" ADD CONSTRAINT "TaskItem_goalRunId_fkey" FOREIGN KEY ("goalRunId") REFERENCES "GoalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Todo" ADD CONSTRAINT "Todo_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceToolCall" ADD CONSTRAINT "TraceToolCall_traceId_fkey" FOREIGN KEY ("traceId") REFERENCES "Trace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

