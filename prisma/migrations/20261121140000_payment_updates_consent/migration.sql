-- A separate, dated opt-in for payment-received WhatsApp messages (see the column comment
-- in schema.prisma). Purely additive: one nullable column with no default, so every
-- existing customer reads as "not opted in".
ALTER TABLE "Customer" ADD COLUMN "paymentUpdatesOptInAt" TIMESTAMP(3);
