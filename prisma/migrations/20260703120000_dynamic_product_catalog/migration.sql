-- Add dynamic product controls used by Daily Entry and billing screens.
ALTER TABLE "Product" ADD COLUMN "shortName" TEXT;
ALTER TABLE "Product" ADD COLUMN "displayOrder" INTEGER;
ALTER TABLE "Product" ADD COLUMN "showInDailyEntry" BOOLEAN NOT NULL DEFAULT true;

WITH ranked_products AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "code" ASC) AS "rowNumber"
  FROM "Product"
)
UPDATE "Product"
SET "displayOrder" = ranked_products."rowNumber"
FROM ranked_products
WHERE "Product"."id" = ranked_products."id";

ALTER TABLE "Product" ALTER COLUMN "displayOrder" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "displayOrder" SET DEFAULT 0;

CREATE INDEX "Product_isActive_showInDailyEntry_displayOrder_idx"
ON "Product"("isActive", "showInDailyEntry", "displayOrder");

CREATE INDEX "DailyRouteEntryLine_entryId_sequenceNo_idx"
ON "DailyRouteEntryLine"("entryId", "sequenceNo");

CREATE INDEX "DailyRouteEntryLineProduct_productId_idx"
ON "DailyRouteEntryLineProduct"("productId");
