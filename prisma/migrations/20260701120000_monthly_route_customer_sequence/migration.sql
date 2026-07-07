-- CreateTable
CREATE TABLE "MonthlyRouteCustomerSequence" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sequenceMonth" DATE NOT NULL,
    "sequenceNo" INTEGER NOT NULL,
    "status" "RouteAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyRouteCustomerSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyRouteCustomerSequence_routeId_sequenceMonth_customerId_key" ON "MonthlyRouteCustomerSequence"("routeId", "sequenceMonth", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyRouteCustomerSequence_routeId_sequenceMonth_sequenceNo_key" ON "MonthlyRouteCustomerSequence"("routeId", "sequenceMonth", "sequenceNo");

-- AddForeignKey
ALTER TABLE "MonthlyRouteCustomerSequence" ADD CONSTRAINT "MonthlyRouteCustomerSequence_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyRouteCustomerSequence" ADD CONSTRAINT "MonthlyRouteCustomerSequence_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
