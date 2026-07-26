import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDriverSheet, saveDriverLine } from "@/lib/driver-data";

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
  const yesterdayLine = await rawPrisma.dailyRouteEntryLine.create({
    data: { entryId: yesterdayEntry.id, customerId, sequenceNo: 1, skipped: false },
  });
  await rawPrisma.dailyRouteEntryLineProduct.create({
    data: { lineId: yesterdayLine.id, productId, quantity: 5, rateSnapshot: 50 },
  });

  const todayEntry = await rawPrisma.dailyRouteEntry.create({
    data: { routeId, entryDate: TODAY, syncStatus: "SYNCED" },
  });
  await rawPrisma.dailyRouteEntryLine.create({
    data: { entryId: todayEntry.id, customerId, sequenceNo: 1, skipped: true },
  });
});

afterAll(async () => {
  // Scoped by routeId (not just the two beforeAll entries) since the
  // location-backfill tests below create further entries via saveDriverLine.
  await rawPrisma.dailyRouteEntryLineProduct.deleteMany({ where: { line: { entry: { routeId } } } });
  await rawPrisma.dailyRouteEntryLine.deleteMany({ where: { entry: { routeId } } });
  await rawPrisma.dailyRouteEntry.deleteMany({ where: { routeId } });
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

describe("saveDriverLine location backfill (dev DB)", () => {
  it("captures location on the first non-skipped save and never overwrites it on later saves", async () => {
    await rawPrisma.customer.update({ where: { id: customerId }, data: { latitude: null, longitude: null } });

    const first = await saveDriverLine(vehicleId, routeId, customerId, "2027-01-20", {
      skipped: false,
      products: [{ productId, quantity: 2, rateSnapshot: 50 }],
      location: { latitude: 28.6, longitude: 77.2 },
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.customer.latitude).toBe("28.6");
      expect(first.customer.longitude).toBe("77.2");
    }

    // A later save with a DIFFERENT location must not move an already-set one.
    const second = await saveDriverLine(vehicleId, routeId, customerId, "2027-01-21", {
      skipped: false,
      products: [{ productId, quantity: 2, rateSnapshot: 50 }],
      location: { latitude: 12.9, longitude: 77.5 },
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.customer.latitude).toBe("28.6");
      expect(second.customer.longitude).toBe("77.2");
    }
  });

  it("does not capture location on a skip", async () => {
    await rawPrisma.customer.update({ where: { id: customerId }, data: { latitude: null, longitude: null } });

    const result = await saveDriverLine(vehicleId, routeId, customerId, "2027-01-25", {
      skipped: true,
      products: [],
      location: { latitude: 28.6, longitude: 77.2 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.customer.latitude).toBeNull();
      expect(result.customer.longitude).toBeNull();
    }
  });

  it("overwrites the saved location when confirmLocationUpdate is true and the drift is real", async () => {
    await rawPrisma.customer.update({ where: { id: customerId }, data: { latitude: 28.6, longitude: 77.2 } });

    const result = await saveDriverLine(vehicleId, routeId, customerId, "2027-01-27", {
      skipped: false,
      products: [{ productId, quantity: 1, rateSnapshot: 50 }],
      location: { latitude: 12.9, longitude: 77.5 }, // clearly >12m from the saved point
      confirmLocationUpdate: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.customer.latitude).toBe("12.9");
      expect(result.customer.longitude).toBe("77.5");
    }
  });

  it("ignores confirmLocationUpdate when the new fix isn't actually more than 12m away (server re-verifies, doesn't trust the flag)", async () => {
    await rawPrisma.customer.update({ where: { id: customerId }, data: { latitude: 28.6, longitude: 77.2 } });

    const result = await saveDriverLine(vehicleId, routeId, customerId, "2027-01-28", {
      skipped: false,
      products: [{ productId, quantity: 1, rateSnapshot: 50 }],
      location: { latitude: 28.6, longitude: 77.2 }, // identical — zero drift
      confirmLocationUpdate: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Unchanged: distance is 0, well under the 12m threshold, so the
      // client's flag alone isn't enough to move an already-set location.
      expect(result.customer.latitude).toBe("28.6");
      expect(result.customer.longitude).toBe("77.2");
    }
  });
});
