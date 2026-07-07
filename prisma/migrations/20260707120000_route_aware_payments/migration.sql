-- Attach payments to routes so one customer payment cannot be applied to every route occurrence.
ALTER TABLE "Payment" ADD COLUMN "routeId" TEXT;

CREATE INDEX "Payment_customerId_routeId_paymentDate_idx"
ON "Payment"("customerId", "routeId", "paymentDate");

CREATE INDEX "Payment_routeId_paymentDate_status_idx"
ON "Payment"("routeId", "paymentDate", "status");

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_routeId_fkey"
FOREIGN KEY ("routeId") REFERENCES "Route"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
