-- Route.vehicleId becomes required.
--
-- The collections sheet is organised by VEHICLE: it lists a vehicle's morning
-- and evening rounds together, because a customer taking milk on both is
-- billed on only one of them. A route with no vehicle appears under no vehicle
-- at all, so its customers silently become uncollectable. Optional was never
-- meaningful here, it was just never enforced.
--
-- Production has no unassigned routes. Development can (test fixtures created
-- before this rule), so backfill first rather than fail the migration: an
-- unassigned route is already unusable, and pinning it to a vehicle in its own
-- city makes it visible again rather than changing anything that worked.
UPDATE "Route" r
SET "vehicleId" = (
  SELECT v."id"
  FROM "Vehicle" v
  WHERE v."cityId" = r."cityId" AND v."isActive" = true
  ORDER BY v."code" ASC
  LIMIT 1
)
WHERE r."vehicleId" IS NULL;

-- Any route left NULL has no vehicle in its city at all; there is nothing to
-- point it at, so deactivate it rather than block the migration. It cannot be
-- run without a vehicle anyway.
UPDATE "Route" SET "isActive" = false WHERE "vehicleId" IS NULL;

DELETE FROM "Route" WHERE "vehicleId" IS NULL AND "isActive" = false
  AND NOT EXISTS (SELECT 1 FROM "MonthlyRouteCustomerSequence" s WHERE s."routeId" = "Route"."id")
  AND NOT EXISTS (SELECT 1 FROM "DailyRouteEntry" d WHERE d."routeId" = "Route"."id")
  AND NOT EXISTS (SELECT 1 FROM "MonthlyBill" b WHERE b."routeId" = "Route"."id")
  AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."routeId" = "Route"."id");

ALTER TABLE "Route" ALTER COLUMN "vehicleId" SET NOT NULL;
