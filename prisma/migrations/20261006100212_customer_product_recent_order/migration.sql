-- DropForeignKey
ALTER TABLE "Route" DROP CONSTRAINT "Route_vehicleId_fkey";

-- AlterTable
ALTER TABLE "CitySetting" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "CustomerProductRecentOrder" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "entries" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProductRecentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProductRecentOrder_customerId_productId_key" ON "CustomerProductRecentOrder"("customerId", "productId");

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProductRecentOrder" ADD CONSTRAINT "CustomerProductRecentOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProductRecentOrder" ADD CONSTRAINT "CustomerProductRecentOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
