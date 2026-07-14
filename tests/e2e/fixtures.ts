import { PrismaClient } from "@prisma/client";

// Shared across the E2E suite: the seeded dev superadmin (see
// prisma/seed.mjs) and the real fixture IDs already living in the dev
// database (Rohtak city, its two routes and three customers). Tests run
// serially (see playwright.config.ts) against this real dev DB rather than
// an isolated test database — deliberate for now, matches how this whole
// project has been hand-verified all session; revisit if it ever needs to
// run somewhere without this exact seeded data.
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
  await prisma.monthlyRouteCustomerSequence.createMany({
    data: customerIds.map((customerId, index) => ({
      routeId,
      customerId,
      sequenceMonth: TEST_MONTH_DATE,
      sequenceNo: index + 1,
      status: "ACTIVE" as const,
    })),
    skipDuplicates: true,
  });
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
