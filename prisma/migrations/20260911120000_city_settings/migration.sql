-- Per-city behaviour switches, key/value so adding a setting needs no
-- migration. Every key has a default in src/lib/city-settings.ts, so a city
-- with no rows here is a valid, fully-configured city — which is why this
-- migration inserts nothing.
CREATE TABLE "CitySetting" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cityId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CitySetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CitySetting_cityId_key_key" ON "CitySetting"("cityId", "key");

ALTER TABLE "CitySetting" ADD CONSTRAINT "CitySetting_cityId_fkey"
    FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
