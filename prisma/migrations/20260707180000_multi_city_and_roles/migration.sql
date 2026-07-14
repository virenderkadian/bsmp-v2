-- Multi-city support + role model.
--
-- User table is confirmed empty at the time of this migration (auth was
-- never wired up), so the UserRole enum rename is safe with no data to
-- remap. Every other table already has real rows, so cityId columns are
-- added nullable, backfilled into one seed city, then tightened to NOT
-- NULL + unique per city in the same transaction.

-- 1. UserRole: ADMIN/MANAGER/ROUTE_OPERATOR/CASHIER -> SUPERADMIN/ADMIN/USER
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM ('SUPERADMIN', 'ADMIN', 'USER');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING ("role"::text::"UserRole");
DROP TYPE "UserRole_old";

-- 2. City
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "City_code_key" ON "City"("code");

-- Seed city all existing data backfills into. Fixed id so the following
-- backfill statements in this same migration can reference it directly.
INSERT INTO "City" ("id", "code", "name", "isActive", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000001', 'ROHTAK', 'Rohtak', true, CURRENT_TIMESTAMP);

-- 3. UserCityAssignment
CREATE TABLE "UserCityAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserCityAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserCityAssignment_userId_cityId_key" ON "UserCityAssignment"("userId", "cityId");
ALTER TABLE "UserCityAssignment" ADD CONSTRAINT "UserCityAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserCityAssignment" ADD CONSTRAINT "UserCityAssignment_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. cityId columns: add nullable, backfill, then tighten to NOT NULL
ALTER TABLE "Vehicle" ADD COLUMN "cityId" TEXT;
ALTER TABLE "Product" ADD COLUMN "cityId" TEXT;
ALTER TABLE "Route" ADD COLUMN "cityId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "cityId" TEXT;
ALTER TABLE "BusinessProfile" ADD COLUMN "cityId" TEXT;

UPDATE "Vehicle" SET "cityId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Product" SET "cityId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Route" SET "cityId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Customer" SET "cityId" = '00000000-0000-0000-0000-000000000001';
UPDATE "BusinessProfile" SET "cityId" = '00000000-0000-0000-0000-000000000001';

ALTER TABLE "Vehicle" ALTER COLUMN "cityId" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "cityId" SET NOT NULL;
ALTER TABLE "Route" ALTER COLUMN "cityId" SET NOT NULL;
ALTER TABLE "Customer" ALTER COLUMN "cityId" SET NOT NULL;
ALTER TABLE "BusinessProfile" ALTER COLUMN "cityId" SET NOT NULL;

ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Route" ADD CONSTRAINT "Route_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. Replace global-unique codes with per-city-unique codes
DROP INDEX "Vehicle_code_key";
DROP INDEX "Vehicle_registration_key";
CREATE UNIQUE INDEX "Vehicle_cityId_code_key" ON "Vehicle"("cityId", "code");
CREATE UNIQUE INDEX "Vehicle_cityId_registration_key" ON "Vehicle"("cityId", "registration");

DROP INDEX "Product_code_key";
CREATE UNIQUE INDEX "Product_cityId_code_key" ON "Product"("cityId", "code");

DROP INDEX "Route_code_key";
CREATE UNIQUE INDEX "Route_cityId_code_key" ON "Route"("cityId", "code");

DROP INDEX "Customer_code_key";
CREATE UNIQUE INDEX "Customer_cityId_code_key" ON "Customer"("cityId", "code");

DROP INDEX "Product_isActive_showInDailyEntry_displayOrder_idx";
CREATE INDEX "Product_cityId_isActive_showInDailyEntry_displayOrder_idx" ON "Product"("cityId", "isActive", "showInDailyEntry", "displayOrder");

-- 6. BusinessProfile: singleton -> one row per city
CREATE UNIQUE INDEX "BusinessProfile_cityId_key" ON "BusinessProfile"("cityId");
