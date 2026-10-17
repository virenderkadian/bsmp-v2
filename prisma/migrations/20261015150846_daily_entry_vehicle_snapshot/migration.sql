-- Record which vehicle actually ran each round, instead of deriving it.
--
-- A route's vehicle can be reassigned (one vehicle covering another's
-- customers while it is off the road), but Route.vehicleId only holds the
-- CURRENT owner. Working the vehicle out from the route at read time means
-- a reassignment made today silently changes who delivered what last week,
-- and with it every reconciliation figure for those days.
--
-- This is the same fix already applied to rates twice in this schema
-- (DailyRouteEntryLineProduct.rateSnapshot, VehicleCycleStock.rateSnapshot):
-- write the fact down while it is true rather than recomputing it later
-- from something that can move.
--
-- The backfill below is EXACT rather than a guess, and only because of when
-- it runs: no route has ever been reassigned to a different vehicle, so a
-- route's current vehicleId IS the vehicle that ran every one of its past
-- entries. That stops being true the first time a route moves — which is
-- precisely what this column exists to survive — so this backfill could not
-- be written correctly after the fact. Same shape of argument as the
-- rateSnapshot backfill in 20260909120000_vehicle_stock_rate_snapshot.
--
-- Nullable rather than NOT NULL: a write path that misses the vehicle should
-- degrade to the old behaviour (reconciliation falls back to the route's
-- current vehicle) rather than failing a save the office needs to complete.
ALTER TABLE "DailyRouteEntry" ADD COLUMN "vehicleId" UUID;

UPDATE "DailyRouteEntry" e
SET "vehicleId" = r."vehicleId"
FROM "Route" r
WHERE r."id" = e."routeId" AND e."vehicleId" IS NULL;

ALTER TABLE "DailyRouteEntry"
  ADD CONSTRAINT "DailyRouteEntry_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "DailyRouteEntry_vehicleId_entryDate_idx" ON "DailyRouteEntry"("vehicleId", "entryDate");
