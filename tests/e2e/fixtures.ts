import { PrismaClient } from "@prisma/client";

// Shared across the E2E suite: the seeded dev superadmin (see prisma/seed.mjs)
// and a fixed set of fixture IDs.
//
// These rows used to be assumed to already exist in the dev database. That
// assumption rotted — the rows were removed at some point and the whole suite
// then died in beforeEach with a foreign-key violation, before any assertion
// ran. ensureTestData() below now CREATES them (idempotently, at these exact
// ids), so the suite seeds what it needs instead of depending on whatever
// happens to be in the database.
export const TEST_SUPERADMIN = {
  email: "takdeerkadian123456@gmail.com",
  password: "superadmin",
};

export const TEST_CITY_ID = "00000000-0000-0000-0000-000000000001"; // Rohtak
export const TEST_ROUTE_ID = "db9eaa23-ee87-4e80-a118-0f56ebdf931a"; // ROUTE-01-M
export const TEST_ROUTE_2_ID = "2db23073-9ad9-4d10-90b8-3788b6a10b21";
export const TEST_CUSTOMER_1_ID = "0e2e7dbe-a9d4-4dc2-be52-4d9cebc12f02"; // cus01
export const TEST_CUSTOMER_2_ID = "b599c11c-e43a-447b-bbee-1e9e169730a6";
export const TEST_CUSTOMER_3_ID = "36afa5b9-2239-4f3d-8ba7-614dbfd9d006";
export const TEST_VEHICLE_ID = "5de299ab-7213-4ad4-a460-9bacb7f05874";
export const TEST_PRODUCT_ID = "c1a7f6d2-0b3e-4a51-9f8c-2d6e5b4a3c21";

// A test-only billing month, deliberately far from any real generated bill
// so tests never risk touching real financial state on the routes above.
export const TEST_MONTH = "2027-01";
export const TEST_MONTH_DATE = new Date("2027-01-01T00:00:00.000Z");

export function testDate(day: string) {
  return `2027-01-${day}`;
}

let client: PrismaClient | undefined;

export function testPrisma() {
  client ??= new PrismaClient();
  return client;
}

export async function ensureTestSequence(routeId: string, customerIds: string[]) {
  const prisma = testPrisma();

  // billsHere must be set per customer rather than left to default true.
  // Only ONE active row per customer+month may carry the bill (enforced by a
  // partial unique index), so adding a customer who already bills on another
  // route has to add them as a non-billing row.
  //
  // This previously used createMany({ skipDuplicates: true }), which SILENTLY
  // dropped that second row — the caller believed the customer was on both
  // routes while the database only had one.
  for (const [index, customerId] of customerIds.entries()) {
    const alreadyBills = await prisma.monthlyRouteCustomerSequence.findFirst({
      where: { customerId, sequenceMonth: TEST_MONTH_DATE, status: "ACTIVE", billsHere: true },
      select: { id: true },
    });

    await prisma.monthlyRouteCustomerSequence.upsert({
      where: {
        routeId_sequenceMonth_customerId: { routeId, sequenceMonth: TEST_MONTH_DATE, customerId },
      },
      update: {},
      create: {
        routeId,
        customerId,
        sequenceMonth: TEST_MONTH_DATE,
        sequenceNo: index + 1,
        status: "ACTIVE",
        billsHere: alreadyBills === null,
      },
    });
  }
}

export async function clearTestMonthData(routeId: string) {
  const prisma = testPrisma();

  const entries = await prisma.dailyRouteEntry.findMany({
    where: {
      routeId,
      entryDate: { gte: new Date("2027-01-01T00:00:00.000Z"), lt: new Date("2027-02-01T00:00:00.000Z") },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  const lineIds = entries.flatMap((entry) => entry.lines.map((line) => line.id));

  await prisma.dailyRouteEntryLineProduct.deleteMany({ where: { lineId: { in: lineIds } } });
  await prisma.dailyRouteEntryLine.deleteMany({ where: { entryId: { in: entries.map((e) => e.id) } } });
  await prisma.dailyRouteEntry.deleteMany({ where: { id: { in: entries.map((e) => e.id) } } });

  await prisma.monthlyBillItem.deleteMany({
    where: { monthlyBill: { routeId, billingMonth: TEST_MONTH_DATE } },
  });
  await prisma.monthlyBill.deleteMany({ where: { routeId, billingMonth: TEST_MONTH_DATE } });
  await prisma.payment.deleteMany({ where: { routeId, paymentDate: { gte: new Date("2027-01-01"), lt: new Date("2027-02-01") } } });
  await prisma.paymentBatch.deleteMany({ where: { routeId, billingMonth: TEST_MONTH_DATE } });
  await prisma.monthlyRouteCustomerSequence.deleteMany({ where: { routeId, sequenceMonth: TEST_MONTH_DATE } });
}

// Creates every row the suite depends on, at fixed ids, without disturbing
// anything else in the database. Safe to run repeatedly — each step is an
// upsert — and cheap enough to call from the auth setup project so it happens
// once before any spec runs.
export async function ensureTestData() {
  const prisma = testPrisma();

  await prisma.city.upsert({
    where: { id: TEST_CITY_ID },
    update: {},
    create: { id: TEST_CITY_ID, code: "RTK", name: "Rohtak" },
  });

  await prisma.product.upsert({
    where: { id: TEST_PRODUCT_ID },
    update: { isActive: true, showInDailyEntry: true, includeInReconciliation: true },
    create: {
      id: TEST_PRODUCT_ID,
      cityId: TEST_CITY_ID,
      code: "E2E-MILK",
      name: "Buffalo Milk",
      unit: "Litre",
      defaultRate: 60,
      isActive: true,
      showInDailyEntry: true,
      // Reconciliation renders nothing at all unless at least one product opts
      // in, so the reconciliation spec depends on this flag.
      includeInReconciliation: true,
    },
  });

  // One vehicle carrying both a morning and an evening route — the
  // reconciliation spec depends on that pairing.
  await prisma.vehicle.upsert({
    where: { id: TEST_VEHICLE_ID },
    update: {},
    create: { id: TEST_VEHICLE_ID, cityId: TEST_CITY_ID, code: "E2E-V01", name: "Vehicle01" },
  });

  await prisma.route.upsert({
    where: { id: TEST_ROUTE_ID },
    update: { isActive: true, vehicleId: TEST_VEHICLE_ID },
    create: {
      id: TEST_ROUTE_ID,
      cityId: TEST_CITY_ID,
      code: "ROUTE-01-M",
      name: "E2E Route 1 Morning",
      shift: "MORNING",
      vehicleId: TEST_VEHICLE_ID,
    },
  });

  await prisma.route.upsert({
    where: { id: TEST_ROUTE_2_ID },
    update: { isActive: true, vehicleId: TEST_VEHICLE_ID },
    create: {
      id: TEST_ROUTE_2_ID,
      cityId: TEST_CITY_ID,
      code: "ROUTE-01-E",
      name: "E2E Route 1 Evening",
      shift: "EVENING",
      vehicleId: TEST_VEHICLE_ID,
    },
  });

  const customers = [
    { id: TEST_CUSTOMER_1_ID, code: "E2E-C01", name: "E2E Customer One" },
    { id: TEST_CUSTOMER_2_ID, code: "E2E-C02", name: "E2E Customer Two" },
    { id: TEST_CUSTOMER_3_ID, code: "E2E-C03", name: "E2E Customer Three" },
  ];

  for (const customer of customers) {
    await prisma.customer.upsert({
      where: { id: customer.id },
      update: { isActive: true },
      create: {
        id: customer.id,
        cityId: TEST_CITY_ID,
        code: customer.code,
        name: customer.name,
        openingBalance: 0,
        isActive: true,
      },
    });
  }
}
