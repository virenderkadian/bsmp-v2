-- A separate, dated opt-in for delivery-completed WhatsApp messages (see the column
-- comment in schema.prisma). Purely additive: one nullable column with no default, so
-- every existing customer reads as "not opted in" and nothing changes until the office
-- opts people in.
ALTER TABLE "Customer" ADD COLUMN "deliveryUpdatesOptInAt" TIMESTAMP(3);
