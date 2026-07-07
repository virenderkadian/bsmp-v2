-- Group route-wise bulk payment entries into auditable batches.
CREATE TABLE "PaymentBatch" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "billingMonth" DATE NOT NULL,
    "paymentDate" DATE NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "defaultStatus" "PaymentStatus" NOT NULL DEFAULT 'VERIFIED',
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "referenceNo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentBatch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Payment" ADD COLUMN "batchId" TEXT;

CREATE INDEX "PaymentBatch_routeId_billingMonth_idx"
ON "PaymentBatch"("routeId", "billingMonth");

CREATE INDEX "PaymentBatch_paymentDate_idx"
ON "PaymentBatch"("paymentDate");

CREATE INDEX "Payment_batchId_idx"
ON "Payment"("batchId");

ALTER TABLE "PaymentBatch"
ADD CONSTRAINT "PaymentBatch_routeId_fkey"
FOREIGN KEY ("routeId") REFERENCES "Route"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "PaymentBatch"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
