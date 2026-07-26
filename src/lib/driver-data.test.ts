import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDriverSheet } from "@/lib/driver-data";

// Self-contained fixture proving the deliveredQty leak is fixed: a customer
// delivered 5 yesterday (becomes their recent-order suggestion), is SKIPPED
// today (no product rows), and the sheet must report today's deliveredQty as
// 0 — not the leftover suggestion — since a real (skipped) line for today
// exists and is authoritative. Hits the real dev DB, like every other
// integration test in this repo; creates and tears down its own rows.

const rawPrisma = new PrismaClient();

let cityId: string;
let vehicleId: string;
let routeId: string;
let customerId: string;
let productId: string;
let yesterdayEntryId: string;
let todayEntryId: string;

const YESTERDAY = new Date(Date.UTC(2027, 0, 14));
const TODAY = new Date(Date.UTC(2027, 0, 15));
const sequenceMonth = new Date(Date.UTC(2027, 0, 1));

beforeAll(async () => {
  const suffix = Date.now().toString().slice(-8);
  const city = await rawPrisma.city.create({ data: { code: `DQ${suffix}`, name: `DeliveredQty Test ${suffix}` } });
  cityId = city.id;

  const vehicle = await rawPrisma.vehicle.create({ data: { cityId, code: `DQV-${suffix}`, name: "Test Vehicle" } });
  vehicleId = vehicle.id;

  const route = await rawPrisma.route.create({
    data: { cityId, code: `DQR-${suffix}`, name: "Test Route", shift: "MORNING", vehicleId },
  });
  routeId = route.id;

  const product = await rawPrisma.product.create({
    data: { cityId, code: `DQP-${suffix}`, name: "Test Product", unit: "L", defaultRate: 50, isActive: true, showInDailyEntry: true },
  });
  productId = product.id;

  const customer = await rawPrisma.customer.create({
    data: { cityId, code: `DQC-${suffix}`, name: "Test Customer", openingBalance: 0 },
  });
  customerId = customer.id;

  await rawPrisma.monthlyRouteCustomerSequence.create({
    data: { routeId, customerId, sequenceMonth, sequenceNo: 1, status: "ACTIVE" },
  });

  const yesterdayEntry = await rawPrisma.dailyRouteEntry.create({
    data: { routeId, entryDate: YESTERDAY, syncStatus: "SYNCED" },
  });
  yesterdayEntryId = yesterdayEntry.id;
  const yesterdayLine = await rawPrisma.dailyRouteEntryLine.create({
    data: { entryId: yesterdayEntryId, customerId, sequenceNo: 1, skipped: false },
  });
  await rawPrisma.dailyRouteEntryLineProduct.create({
    data: { lineId: yesterdayLine.id, productId, quantity: 5, rateSnapshot: 50 },
  });

  const todayEntry = await rawPrisma.dailyRouteEntry.create({
    data: { routeId, entryDate: TODAY, syncStatus: "SYNCED" },
  });
  todayEntryId = todayEntry.id;
  await rawPrisma.dailyRouteEntryLine.create({
    data: { entryId: todayEntryId, customerId, sequenceNo: 1, skipped: true },
  });
});

afterAll(async () => {
  await rawPrisma.dailyRouteEntryLineProduct.deleteMany({ where: { line: { entryId: { in: [yesterdayEntryId, todayEntryId] } } } });
  await rawPrisma.dailyRouteEntryLine.deleteMany({ where: { entryId: { in: [yesterdayEntryId, todayEntryId] } } });
  await rawPrisma.dailyRouteEntry.deleteMany({ where: { id: { in: [yesterdayEntryId, todayEntryId] } } });
  await rawPrisma.monthlyRouteCustomerSequence.deleteMany({ where: { routeId } });
  await rawPrisma.customer.delete({ where: { id: customerId } });
  await rawPrisma.product.delete({ where: { id: productId } });
  await rawPrisma.route.delete({ where: { id: routeId } });
  await rawPrisma.vehicle.delete({ where: { id: vehicleId } });
  await rawPrisma.city.delete({ where: { id: cityId } });
  await rawPrisma.$disconnect();
});

describe("driver sheet deliveredQty (dev DB)", () => {
  it("reports 0 for a skipped day, not yesterday's recent-order suggestion", async () => {
    const sheet = await getDriverSheet(vehicleId, routeId, "2027-01-15");
    expect(sheet).not.toBeNull();

    const customer = sheet!.customers.find((c) => c.customerId === customerId);
    const product = customer?.products.find((p) => p.productId === productId);

    expect(product?.defaultQty).toBe("5"); // suggestion still reflects yesterday
    expect(product?.deliveredQty).toBe("0"); // but today's actual line is authoritative
  });

  it("still shows yesterday's quantity as both default and delivered when unsaved (no line yet)", async () => {
    const sheet = await getDriverSheet(vehicleId, routeId, "2027-01-16");
    const customer = sheet!.customers.find((c) => c.customerId === customerId);
    const product = customer?.products.find((p) => p.productId === productId);

    expect(product?.defaultQty).toBe("5");
    expect(product?.deliveredQty).toBe("5");
  });
});
