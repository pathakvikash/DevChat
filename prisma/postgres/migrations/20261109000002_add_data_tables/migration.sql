-- CreateTable
CREATE TABLE "DataTable" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "columns" TEXT NOT NULL DEFAULT '[]',
    "statuses" TEXT NOT NULL DEFAULT '["new"]',
    "privateFrom" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataTableRow" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "data" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataTableRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DataTable_userId_name_key" ON "DataTable"("userId", "name");

-- CreateIndex
CREATE INDEX "DataTableRow_tableId_status_idx" ON "DataTableRow"("tableId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DataTableRow_tableId_key_key" ON "DataTableRow"("tableId", "key");

-- AddForeignKey
ALTER TABLE "DataTable" ADD CONSTRAINT "DataTable_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataTableRow" ADD CONSTRAINT "DataTableRow_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DataTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

