-- Freeze the rate a vehicle cycle's cash sale was valued at.
--
-- Cash sales are priced as (given - delivered - returned) x rate, and the rate
-- was read from Product.defaultRate at display time. That made every past
-- month's "driver owes" move whenever a product rate changed — silently, and
-- with no way to recover what the figure had been.
--
-- The backfill below is EXACT rather than approximate, and only because of
-- when it runs: no product rate has been changed yet, so today's defaultRate
-- is also every historical rate. That stops being true the first time a rate
-- moves, and the original values would then be unrecoverable.
ALTER TABLE "VehicleCycleStock" ADD COLUMN "rateSnapshot" DECIMAL(10,2);

UPDATE "VehicleCycleStock" s
SET "rateSnapshot" = p."defaultRate"
FROM "Product" p
WHERE p."id" = s."productId" AND s."rateSnapshot" IS NULL;
