-- CreateTable
CREATE TABLE "DataTable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "columns" TEXT NOT NULL DEFAULT '[]',
    "statuses" TEXT NOT NULL DEFAULT '["new"]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DataTable_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DataTableRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tableId" TEXT NOT NULL,
    "key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DataTableRow_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DataTable" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DataTable_userId_name_key" ON "DataTable"("userId", "name");

-- CreateIndex
CREATE INDEX "DataTableRow_tableId_status_idx" ON "DataTableRow"("tableId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DataTableRow_tableId_key_key" ON "DataTableRow"("tableId", "key");

