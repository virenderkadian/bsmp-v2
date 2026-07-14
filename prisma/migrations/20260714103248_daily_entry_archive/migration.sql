-- CreateEnum
CREATE TYPE "DailyEntryArchiveStatus" AS ENUM ('EXPORTED', 'DELETED', 'RESTORED');

-- CreateTable
CREATE TABLE "DailyEntryArchive" (
    "id" UUID NOT NULL,
    "cityId" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "billingMonth" DATE NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "lineCount" INTEGER NOT NULL,
    "productEntryCount" INTEGER NOT NULL,
    "sequenceCount" INTEGER NOT NULL,
    "status" "DailyEntryArchiveStatus" NOT NULL DEFAULT 'EXPORTED',
    "exportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "restoredAt" TIMESTAMP(3),

    CONSTRAINT "DailyEntryArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyEntryArchive_cityId_billingMonth_idx" ON "DailyEntryArchive"("cityId", "billingMonth");

-- CreateIndex
CREATE UNIQUE INDEX "DailyEntryArchive_routeId_billingMonth_key" ON "DailyEntryArchive"("routeId", "billingMonth");

-- AddForeignKey
ALTER TABLE "DailyEntryArchive" ADD CONSTRAINT "DailyEntryArchive_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyEntryArchive" ADD CONSTRAINT "DailyEntryArchive_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
