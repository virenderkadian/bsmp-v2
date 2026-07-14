-- Converts every id/foreign-key column from TEXT (Prisma's default String
-- storage for @default(uuid()) fields, ~37 bytes on disk) to native
-- Postgres UUID (16 bytes fixed). Every stored value is already a valid
-- UUID string, so the ::uuid cast is lossless. FKs must be dropped before
-- altering either side of the relationship (Postgres forbids changing the
-- type of a column referenced by a cross-table FK) and recreated after.

-- Drop all foreign keys
ALTER TABLE "BusinessProfile" DROP CONSTRAINT "BusinessProfile_cityId_fkey";
ALTER TABLE "Customer" DROP CONSTRAINT "Customer_cityId_fkey";
ALTER TABLE "DailyRouteEntry" DROP CONSTRAINT "DailyRouteEntry_operatorId_fkey";
ALTER TABLE "DailyRouteEntry" DROP CONSTRAINT "DailyRouteEntry_routeId_fkey";
ALTER TABLE "DailyRouteEntryLine" DROP CONSTRAINT "DailyRouteEntryLine_customerId_fkey";
ALTER TABLE "DailyRouteEntryLine" DROP CONSTRAINT "DailyRouteEntryLine_entryId_fkey";
ALTER TABLE "DailyRouteEntryLineProduct" DROP CONSTRAINT "DailyRouteEntryLineProduct_lineId_fkey";
ALTER TABLE "DailyRouteEntryLineProduct" DROP CONSTRAINT "DailyRouteEntryLineProduct_productId_fkey";
ALTER TABLE "MonthlyBill" DROP CONSTRAINT "MonthlyBill_customerId_fkey";
ALTER TABLE "MonthlyBill" DROP CONSTRAINT "MonthlyBill_routeId_fkey";
ALTER TABLE "MonthlyBillItem" DROP CONSTRAINT "MonthlyBillItem_monthlyBillId_fkey";
ALTER TABLE "MonthlyBillItem" DROP CONSTRAINT "MonthlyBillItem_productId_fkey";
ALTER TABLE "MonthlyRouteCustomerSequence" DROP CONSTRAINT "MonthlyRouteCustomerSequence_customerId_fkey";
ALTER TABLE "MonthlyRouteCustomerSequence" DROP CONSTRAINT "MonthlyRouteCustomerSequence_routeId_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_batchId_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_collectedById_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_customerId_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_routeId_fkey";
ALTER TABLE "PaymentBatch" DROP CONSTRAINT "PaymentBatch_routeId_fkey";
ALTER TABLE "Product" DROP CONSTRAINT "Product_cityId_fkey";
ALTER TABLE "Route" DROP CONSTRAINT "Route_cityId_fkey";
ALTER TABLE "Route" DROP CONSTRAINT "Route_vehicleId_fkey";
ALTER TABLE "RouteCustomerAssignment" DROP CONSTRAINT "RouteCustomerAssignment_customerId_fkey";
ALTER TABLE "RouteCustomerAssignment" DROP CONSTRAINT "RouteCustomerAssignment_routeId_fkey";
ALTER TABLE "RouteCustomerProductDefault" DROP CONSTRAINT "RouteCustomerProductDefault_assignmentId_fkey";
ALTER TABLE "RouteCustomerProductDefault" DROP CONSTRAINT "RouteCustomerProductDefault_productId_fkey";
ALTER TABLE "UserCityAssignment" DROP CONSTRAINT "UserCityAssignment_cityId_fkey";
ALTER TABLE "UserCityAssignment" DROP CONSTRAINT "UserCityAssignment_userId_fkey";
ALTER TABLE "Vehicle" DROP CONSTRAINT "Vehicle_cityId_fkey";

-- Drop a stray default left over from BusinessProfile's pre-multi-city
-- singleton-row design (id was fixed to the literal 'default'); it blocks
-- casting the column to uuid and has been dead since id switched to
-- @default(uuid()) (Prisma generates ids client-side, never relies on this).
ALTER TABLE "BusinessProfile" ALTER COLUMN "id" DROP DEFAULT;

-- The one existing BusinessProfile row still carries its id from before the
-- multi-city migration, when id was a fixed literal ('default') rather than
-- a generated uuid. Nothing references BusinessProfile.id via FK, so it's
-- safe to reassign in place.
UPDATE "BusinessProfile" SET "id" = 'ef566102-630a-46bd-923f-ed59a89359f6' WHERE "id" = 'default';

-- Convert columns to native uuid
ALTER TABLE "City" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;

ALTER TABLE "User" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;

ALTER TABLE "UserCityAssignment"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid,
  ALTER COLUMN "cityId" TYPE UUID USING "cityId"::uuid;

ALTER TABLE "Vehicle"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "cityId" TYPE UUID USING "cityId"::uuid;

ALTER TABLE "Product"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "cityId" TYPE UUID USING "cityId"::uuid;

ALTER TABLE "Route"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "cityId" TYPE UUID USING "cityId"::uuid,
  ALTER COLUMN "vehicleId" TYPE UUID USING "vehicleId"::uuid;

ALTER TABLE "Customer"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "cityId" TYPE UUID USING "cityId"::uuid;

ALTER TABLE "RouteCustomerAssignment"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "routeId" TYPE UUID USING "routeId"::uuid,
  ALTER COLUMN "customerId" TYPE UUID USING "customerId"::uuid;

ALTER TABLE "RouteCustomerProductDefault"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "assignmentId" TYPE UUID USING "assignmentId"::uuid,
  ALTER COLUMN "productId" TYPE UUID USING "productId"::uuid;

ALTER TABLE "MonthlyRouteCustomerSequence"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "routeId" TYPE UUID USING "routeId"::uuid,
  ALTER COLUMN "customerId" TYPE UUID USING "customerId"::uuid;

ALTER TABLE "DailyRouteEntry"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "routeId" TYPE UUID USING "routeId"::uuid,
  ALTER COLUMN "operatorId" TYPE UUID USING "operatorId"::uuid;

ALTER TABLE "DailyRouteEntryLine"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "entryId" TYPE UUID USING "entryId"::uuid,
  ALTER COLUMN "customerId" TYPE UUID USING "customerId"::uuid;

ALTER TABLE "DailyRouteEntryLineProduct"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "lineId" TYPE UUID USING "lineId"::uuid,
  ALTER COLUMN "productId" TYPE UUID USING "productId"::uuid;

ALTER TABLE "Payment"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "customerId" TYPE UUID USING "customerId"::uuid,
  ALTER COLUMN "routeId" TYPE UUID USING "routeId"::uuid,
  ALTER COLUMN "batchId" TYPE UUID USING "batchId"::uuid,
  ALTER COLUMN "collectedById" TYPE UUID USING "collectedById"::uuid;

ALTER TABLE "PaymentBatch"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "routeId" TYPE UUID USING "routeId"::uuid;

ALTER TABLE "MonthlyBill"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "customerId" TYPE UUID USING "customerId"::uuid,
  ALTER COLUMN "routeId" TYPE UUID USING "routeId"::uuid;

ALTER TABLE "MonthlyBillItem"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "monthlyBillId" TYPE UUID USING "monthlyBillId"::uuid,
  ALTER COLUMN "productId" TYPE UUID USING "productId"::uuid;

ALTER TABLE "BusinessProfile"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "cityId" TYPE UUID USING "cityId"::uuid;

-- Recreate all foreign keys
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyRouteEntry" ADD CONSTRAINT "DailyRouteEntry_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DailyRouteEntry" ADD CONSTRAINT "DailyRouteEntry_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyRouteEntryLine" ADD CONSTRAINT "DailyRouteEntryLine_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyRouteEntryLine" ADD CONSTRAINT "DailyRouteEntryLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "DailyRouteEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyRouteEntryLineProduct" ADD CONSTRAINT "DailyRouteEntryLineProduct_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "DailyRouteEntryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyRouteEntryLineProduct" ADD CONSTRAINT "DailyRouteEntryLineProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonthlyBill" ADD CONSTRAINT "MonthlyBill_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonthlyBill" ADD CONSTRAINT "MonthlyBill_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonthlyBillItem" ADD CONSTRAINT "MonthlyBillItem_monthlyBillId_fkey" FOREIGN KEY ("monthlyBillId") REFERENCES "MonthlyBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonthlyBillItem" ADD CONSTRAINT "MonthlyBillItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonthlyRouteCustomerSequence" ADD CONSTRAINT "MonthlyRouteCustomerSequence_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonthlyRouteCustomerSequence" ADD CONSTRAINT "MonthlyRouteCustomerSequence_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PaymentBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentBatch" ADD CONSTRAINT "PaymentBatch_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Route" ADD CONSTRAINT "Route_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Route" ADD CONSTRAINT "Route_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RouteCustomerAssignment" ADD CONSTRAINT "RouteCustomerAssignment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteCustomerAssignment" ADD CONSTRAINT "RouteCustomerAssignment_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteCustomerProductDefault" ADD CONSTRAINT "RouteCustomerProductDefault_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "RouteCustomerAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteCustomerProductDefault" ADD CONSTRAINT "RouteCustomerProductDefault_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserCityAssignment" ADD CONSTRAINT "UserCityAssignment_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserCityAssignment" ADD CONSTRAINT "UserCityAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
