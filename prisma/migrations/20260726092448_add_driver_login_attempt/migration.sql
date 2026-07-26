-- CreateTable
CREATE TABLE "DriverLoginAttempt" (
    "id" UUID NOT NULL,
    "vehicleCode" TEXT NOT NULL,
    "ipAddress" TEXT,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverLoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriverLoginAttempt_vehicleCode_createdAt_idx" ON "DriverLoginAttempt"("vehicleCode", "createdAt");

-- CreateIndex
CREATE INDEX "DriverLoginAttempt_ipAddress_createdAt_idx" ON "DriverLoginAttempt"("ipAddress", "createdAt");
