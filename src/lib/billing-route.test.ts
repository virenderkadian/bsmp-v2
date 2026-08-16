import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBillPairs, resolveBillingRoutes, selectStaleDuplicateBills } from "@/lib/monthly-bills-math";

// End-to-end cover for "one combined bill per customer" against a REAL database.
//
// The pure math is unit-tested in monthly-bills-math.test.ts. What that can't
// prove is the half that lives in Postgres — the partial unique index that
// enforces one billing route, and whether real rows flow through the pipeline
// the way the pure functions assume. Both are where the original money bug lived.
//
// Self-seeding (own city, routes, customers, products) rather than relying on
// shared fixture IDs, so it keeps working after a database reset — the existing
// Playwright fixtures point at rows that no longer exist and fail before any
// assertion runs.

const prisma = new PrismaClient();

let cityId: string;
let morningRouteId: string;
let eveningRouteId: string;
let customerId: string;
let otherCustomerId: string;
let productId: string;

const MONTH = new Date(Date.UTC(2029, 4, 1));
const NEXT_MONTH = new Date(Date.UTC(2029, 5, 1));
const DAY_2 = new Date(Date.UTC(2029, 4, 2));
const DAY_3 = new Date(Date.UTC(2029, 4, 3));

async function addSequenceRow(routeId: string, forCustomerId: string, billsHere: boolean, sequenceNo = 1) {
  return prisma.monthlyRouteCustomerSequence.create({
    data: { routeId, customerId: forCustomerId, sequenceMonth: MONTH, sequenceNo, status: "ACTIVE", billsHere },
  });
}

async function addDelivery(routeId: string, entryDate: Date, quantity: number, rate: number) {
  const entry = await prisma.dailyRouteEntry.upsert({
    where: { routeId_entryDate: { routeId, entryDate } },
    update: {},
    create: { routeId, entryDate, syncStatus: "SYNCED" },
    select: { id: true },
  });
  const line = await prisma.dailyRouteEntryLine.upsert({
    where: { entryId_customerId: { entryId: entry.id, customerId } },
    update: {},
    create: { entryId: entry.id, customerId, sequenceNo: 1, skipped: false },
    select: { id: true },
  });
  await prisma.dailyRouteEntryLineProduct.upsert({
    where: { lineId_productId: { lineId: line.id, productId } },
    update: { quantity, rateSnapshot: rate },
    create: { lineId: line.id, productId, quantity, rateSnapshot: rate },
  });
  return line.id;
}

// Mirrors what generateMonthlyBills does between the database and the pure
// math, so the pipeline is exercised on real rows rather than hand-built maps.
async function runBillPipeline() {
  const entries = await prisma.dailyRouteEntry.findMany({
    where: { route: { cityId }, entryDate: { gte: MONTH, lt: NEXT_MONTH } },
    select: {
      routeId: true,
      lines: {
        select: {
          customerId: true,
          productEntries: { select: { productId: true, quantity: true, rateSnapshot: true } },
        },
      },
    },
  });

  const billMap = new Map<
    string,
    {
      customerId: string;
      routeId: string;
      deliveryAmount: number;
      items: Map<string, { qty: number; totalAmount: number; rateTotal: number; rateCount: number }>;
    }
  >();

  entries.forEach((entry) => {
    entry.lines.forEach((line) => {
      const key = `${line.customerId}:${entry.routeId}`;
      const current =
        billMap.get(key) ??
        { customerId: line.customerId, routeId: entry.routeId, deliveryAmount: 0, items: new Map() };

      line.productEntries.forEach((productEntry) => {
        const qty = Number(productEntry.quantity);
        const rate = Number(productEntry.rateSnapshot);
        current.deliveryAmount += qty * rate;
        const item = current.items.get(productEntry.productId) ?? {
          qty: 0,
          totalAmount: 0,
          rateTotal: 0,
          rateCount: 0,
        };
        item.qty += qty;
        item.totalAmount += qty * rate;
        item.rateTotal += rate;
        item.rateCount += 1;
        current.items.set(productEntry.productId, item);
      });

      billMap.set(key, current);
    });
  });

  const sequenceLines = await prisma.monthlyRouteCustomerSequence.findMany({
    where: { route: { cityId }, sequenceMonth: MONTH, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { customerId: true, routeId: true, billsHere: true },
  });

  return buildBillPairs(billMap, sequenceLines);
}

beforeAll(async () => {
  const suffix = Date.now().toString().slice(-8);
  const city = await prisma.city.create({ data: { code: `BR${suffix}`, name: `BillingRoute Test ${suffix}` } });
  cityId = city.id;

  const morning = await prisma.route.create({
    data: { cityId, code: `BRM-${suffix}`, name: "Test Morning", shift: "MORNING" },
  });
  morningRouteId = morning.id;
  const evening = await prisma.route.create({
    data: { cityId, code: `BRE-${suffix}`, name: "Test Evening", shift: "EVENING" },
  });
  eveningRouteId = evening.id;

  const product = await prisma.product.create({
    data: { cityId, code: `BRP-${suffix}`, name: "Test Milk", unit: "L", defaultRate: 50, isActive: true, showInDailyEntry: true },
  });
  productId = product.id;

  const customer = await prisma.customer.create({
    data: { cityId, code: `BRC-${suffix}`, name: "Two Route Customer", openingBalance: 0 },
  });
  customerId = customer.id;

  const other = await prisma.customer.create({
    data: { cityId, code: `BRO-${suffix}`, name: "Single Route Customer", openingBalance: 0 },
  });
  otherCustomerId = other.id;
});

afterAll(async () => {
  const routeIds = [morningRouteId, eveningRouteId].filter(Boolean);
  await prisma.monthlyBillItem.deleteMany({ where: { monthlyBill: { routeId: { in: routeIds } } } });
  await prisma.monthlyBill.deleteMany({ where: { routeId: { in: routeIds } } });
  await prisma.dailyRouteEntryLineProduct.deleteMany({ where: { line: { entry: { routeId: { in: routeIds } } } } });
  await prisma.dailyRouteEntryLine.deleteMany({ where: { entry: { routeId: { in: routeIds } } } });
  await prisma.dailyRouteEntry.deleteMany({ where: { routeId: { in: routeIds } } });
  await prisma.monthlyRouteCustomerSequence.deleteMany({ where: { routeId: { in: routeIds } } });
  await prisma.route.deleteMany({ where: { id: { in: routeIds } } });
  await prisma.customer.deleteMany({ where: { cityId } });
  await prisma.product.deleteMany({ where: { cityId } });
  await prisma.city.deleteMany({ where: { id: cityId } });
  await prisma.$disconnect();
});

// The database, not the app, is what makes "one billing route" true. If this
// index is wrong, every guard in the application layer is a suggestion.
describe("partial unique index: one billing route per customer per month", () => {
  it("rejects a SECOND route flagged as the billing route", async () => {
    await addSequenceRow(morningRouteId, customerId, true);

    await expect(addSequenceRow(eveningRouteId, customerId, true)).rejects.toThrow();

    await prisma.monthlyRouteCustomerSequence.deleteMany({ where: { customerId, sequenceMonth: MONTH } });
  });

  it("allows two routes when only one carries the bill", async () => {
    await addSequenceRow(morningRouteId, customerId, true);
    await addSequenceRow(eveningRouteId, customerId, false);

    const rows = await prisma.monthlyRouteCustomerSequence.findMany({
      where: { customerId, sequenceMonth: MONTH },
    });
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.billsHere)).toHaveLength(1);

    await prisma.monthlyRouteCustomerSequence.deleteMany({ where: { customerId, sequenceMonth: MONTH } });
  });

  it("allows BOTH to be false — the index forbids a second true, it does not require one", async () => {
    // This state is reachable (a mistake, or removal of the flagged row), which
    // is exactly why resolveBillingRoutes has an earliest-row fallback.
    await addSequenceRow(morningRouteId, customerId, false);
    await addSequenceRow(eveningRouteId, customerId, false);

    const rows = await prisma.monthlyRouteCustomerSequence.findMany({
      where: { customerId, sequenceMonth: MONTH },
      orderBy: { createdAt: "asc" },
      select: { customerId: true, routeId: true, billsHere: true },
    });

    // Still resolves to exactly one route rather than none.
    const resolved = resolveBillingRoutes(rows);
    expect(resolved.get(customerId)).toBe(morningRouteId);

    await prisma.monthlyRouteCustomerSequence.deleteMany({ where: { customerId, sequenceMonth: MONTH } });
  });

  it("scopes per month — the same customer can bill on a route in a different month", async () => {
    await addSequenceRow(morningRouteId, customerId, true);
    const nextMonthRow = await prisma.monthlyRouteCustomerSequence.create({
      data: {
        routeId: eveningRouteId,
        customerId,
        sequenceMonth: NEXT_MONTH,
        sequenceNo: 1,
        status: "ACTIVE",
        billsHere: true,
      },
    });

    expect(nextMonthRow.billsHere).toBe(true);

    await prisma.monthlyRouteCustomerSequence.deleteMany({ where: { customerId } });
  });

  it("scopes per customer — two different customers can each bill on the same route", async () => {
    await addSequenceRow(morningRouteId, customerId, true, 1);
    await addSequenceRow(morningRouteId, otherCustomerId, true, 2);

    const flagged = await prisma.monthlyRouteCustomerSequence.count({
      where: { routeId: morningRouteId, sequenceMonth: MONTH, billsHere: true },
    });
    expect(flagged).toBe(2);

    await prisma.monthlyRouteCustomerSequence.deleteMany({ where: { sequenceMonth: MONTH } });
  });
});

describe("bill pipeline over real rows", () => {
  it("gives a morning+evening customer ONE bill covering both routes", async () => {
    await addSequenceRow(morningRouteId, customerId, true);
    await addSequenceRow(eveningRouteId, customerId, false);
    await addDelivery(morningRouteId, DAY_2, 2, 50); // 100
    await addDelivery(eveningRouteId, DAY_2, 3, 50); // 150 — same day, other route
    await addDelivery(morningRouteId, DAY_3, 1, 50); // 50

    const pairs = await runBillPipeline();

    expect(pairs.size).toBe(1);
    const bill = pairs.get(customerId)!;
    expect(bill.routeId).toBe(morningRouteId);
    expect(bill.deliveryAmount).toBe(300);
    expect(bill.items.get(productId)?.qty).toBe(6);
  });

  it("moves the whole bill when the billing route is switched to evening", async () => {
    await prisma.monthlyRouteCustomerSequence.updateMany({
      where: { customerId, sequenceMonth: MONTH },
      data: { billsHere: false },
    });
    await prisma.monthlyRouteCustomerSequence.updateMany({
      where: { customerId, sequenceMonth: MONTH, routeId: eveningRouteId },
      data: { billsHere: true },
    });

    const pairs = await runBillPipeline();

    expect(pairs.size).toBe(1);
    expect(pairs.get(customerId)?.routeId).toBe(eveningRouteId);
    // Amount is unchanged — only where it's issued moved.
    expect(pairs.get(customerId)?.deliveryAmount).toBe(300);
  });

  it("keeps billing deliveries from a route the customer was removed from mid-month", async () => {
    // Remove the MORNING sequence row; its deliveries stay in the database.
    await prisma.monthlyRouteCustomerSequence.deleteMany({
      where: { customerId, sequenceMonth: MONTH, routeId: morningRouteId },
    });

    const remainingEntries = await prisma.dailyRouteEntryLine.count({
      where: { customerId, entry: { routeId: morningRouteId } },
    });
    expect(remainingEntries).toBeGreaterThan(0);

    const pairs = await runBillPipeline();

    expect(pairs.size).toBe(1);
    expect(pairs.get(customerId)?.routeId).toBe(eveningRouteId);
    // The 150 delivered on the removed morning route is still charged for.
    expect(pairs.get(customerId)?.deliveryAmount).toBe(300);
  });

  it("still bills a customer removed from EVERY route, on the route the deliveries happened on", async () => {
    await prisma.monthlyRouteCustomerSequence.deleteMany({ where: { customerId, sequenceMonth: MONTH } });

    const pairs = await runBillPipeline();

    expect(pairs.size).toBe(1);
    const bill = pairs.get(customerId)!;
    expect(bill.deliveryAmount).toBe(300);
    expect([morningRouteId, eveningRouteId]).toContain(bill.routeId);
  });
});

describe("stale duplicate sweep over real bill rows", () => {
  it("marks the bill on a route that no longer bills the customer, and never the keeper", async () => {
    await addSequenceRow(morningRouteId, customerId, true);
    await addSequenceRow(eveningRouteId, customerId, false);

    const morningBill = await prisma.monthlyBill.create({
      data: {
        customerId,
        routeId: morningRouteId,
        billingMonth: MONTH,
        openingBalance: 0,
        deliveryAmount: 300,
        paymentAmount: 0,
        closingBalance: 300,
        status: "DRAFT",
      },
      select: { id: true, customerId: true, routeId: true },
    });
    const eveningBill = await prisma.monthlyBill.create({
      data: {
        customerId,
        routeId: eveningRouteId,
        billingMonth: MONTH,
        openingBalance: 0,
        deliveryAmount: 150,
        paymentAmount: 0,
        closingBalance: 150,
        status: "DRAFT",
      },
      select: { id: true, customerId: true, routeId: true },
    });

    const pairs = await runBillPipeline();
    const stale = selectStaleDuplicateBills(
      [morningBill, eveningBill],
      new Map([...pairs.values()].map((pair) => [pair.customerId, pair.routeId])),
    );

    expect(stale).toEqual([eveningBill.id]);
    expect(stale).not.toContain(morningBill.id);
  });
});
