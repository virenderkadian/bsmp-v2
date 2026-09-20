-- A per-vehicle UPI id, so money arriving can be told apart by round. Nullable
-- and with no backfill: empty means "use the city's business profile id", which
-- is exactly what every vehicle does today.
ALTER TABLE "Vehicle" ADD COLUMN "upiId" TEXT;
