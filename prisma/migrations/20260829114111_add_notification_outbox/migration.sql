-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationFormat" AS ENUM ('TEXT', 'IMAGE', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "whatsappOptInAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'WHATSAPP',
    "format" "NotificationFormat" NOT NULL DEFAULT 'TEXT',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "recipient" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "media" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "batchId" UUID,
    "notBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_channel_notBefore_idx" ON "NotificationOutbox"("status", "channel", "notBefore");

-- CreateIndex
CREATE INDEX "NotificationOutbox_batchId_idx" ON "NotificationOutbox"("batchId");

-- CreateIndex
CREATE INDEX "NotificationOutbox_customerId_createdAt_idx" ON "NotificationOutbox"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationOutbox_customerId_template_dedupeKey_key" ON "NotificationOutbox"("customerId", "template", "dedupeKey");

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
