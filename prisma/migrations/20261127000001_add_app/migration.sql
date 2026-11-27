-- CreateTable
CREATE TABLE "App" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "mcpUrl" TEXT NOT NULL,
    "manifestJson" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "toolsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ok',
    "toolsCachedAt" DATETIME,
    "secretEnc" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
