-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "includeInReconciliation" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "VehicleCycleStock" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "cycleDate" DATE NOT NULL,
    "givenQty" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "returnedQty" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleCycleStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleCashSalePayment" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "cycleDate" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentDate" DATE NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "referenceNo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleCashSalePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCycleStock_vehicleId_productId_cycleDate_key" ON "VehicleCycleStock"("vehicleId", "productId", "cycleDate");

-- CreateIndex
CREATE INDEX "VehicleCashSalePayment_vehicleId_cycleDate_idx" ON "VehicleCashSalePayment"("vehicleId", "cycleDate");

-- AddForeignKey
ALTER TABLE "VehicleCycleStock" ADD CONSTRAINT "VehicleCycleStock_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCycleStock" ADD CONSTRAINT "VehicleCycleStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleCashSalePayment" ADD CONSTRAINT "VehicleCashSalePayment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
