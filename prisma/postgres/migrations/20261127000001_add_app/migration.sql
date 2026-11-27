-- CreateTable
CREATE TABLE "App" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "mcpUrl" TEXT NOT NULL,
    "manifestJson" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "toolsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ok',
    "toolsCachedAt" TIMESTAMP(3),
    "secretEnc" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);
