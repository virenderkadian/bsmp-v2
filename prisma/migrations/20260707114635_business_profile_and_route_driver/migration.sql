-- AlterTable
ALTER TABLE "Route" ADD COLUMN     "driverName" TEXT,
ADD COLUMN     "driverPhone" TEXT;

-- CreateTable
CREATE TABLE "BusinessProfile" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "businessName" TEXT NOT NULL,
    "contactPhone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "bankIfsc" TEXT,
    "bankName" TEXT,
    "upiId" TEXT,
    "footerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessProfile_pkey" PRIMARY KEY ("id")
);

-- RenameIndex
ALTER INDEX "MonthlyRouteCustomerSequence_routeId_sequenceMonth_customerId_k" RENAME TO "MonthlyRouteCustomerSequence_routeId_sequenceMonth_customer_key";

-- RenameIndex
ALTER INDEX "MonthlyRouteCustomerSequence_routeId_sequenceMonth_sequenceNo_k" RENAME TO "MonthlyRouteCustomerSequence_routeId_sequenceMonth_sequence_key";
