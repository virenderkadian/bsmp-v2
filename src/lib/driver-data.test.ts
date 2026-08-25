import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getDriverSheet,
  recordDriverPayment,
  saveDriverLine,
  updateDriverCustomerMobile,
} from "@/lib/driver-data";

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
// A SECOND city with its own active product, used to prove the driver sheet
// never leaks another city's catalog (see the city-isolation tests below).
let otherCityId: string;
let otherCityProductId: string;

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

  // Second city + its own active, daily-entry-visible product. Nothing about
  // it should ever surface on the first city's driver sheet.
  const otherCity = await rawPrisma.city.create({
    data: { code: `DQX${suffix}`, name: `Other City ${suffix}` },
  });
  otherCityId = otherCity.id;
  const otherProduct = await rawPrisma.product.create({
    data: {
      cityId: otherCityId,
      code: `DQO-${suffix}`,
      name: "Other City Product",
      unit: "L",
      defaultRate: 99,
      isActive: true,
      showInDailyEntry: true,
    },
  });
  otherCityProductId = otherProduct.id;

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
  await rawPrisma.product.delete({ where: { id: otherCityProductId } });
  await rawPrisma.city.delete({ where: { id: otherCityId } });
  await rawPrisma.$disconnect();
});

describe("driver sheet deliveredQty (dev DB)", () => {
  it("reports 0 for a skipped day, not yesterday's recent-order suggestion", async () => {
    const sheet = await getDriverSheet(vehicleId, cityId, routeId, "2027-01-15");
    expect(sheet).not.toBeNull();

    const customer = sheet!.customers.find((c) => c.customerId === customerId);
    const product = customer?.products.find((p) => p.productId === productId);

    expect(product?.defaultQty).toBe("5"); // suggestion still reflects yesterday
    expect(product?.deliveredQty).toBe("0"); // but today's actual line is authoritative
  });

  it("still shows yesterday's quantity as both default and delivered when unsaved (no line yet)", async () => {
    const sheet = await getDriverSheet(vehicleId, cityId, routeId, "2027-01-16");
    const customer = sheet!.customers.find((c) => c.customerId === customerId);
    const product = customer?.products.find((p) => p.productId === productId);

    expect(product?.defaultQty).toBe("5");
    expect(product?.deliveredQty).toBe("5");
  });
});

// Regression tests for a real production leak: getDriverSheet listed the
// product catalog with no cityId filter, relying on the Prisma city-scope
// backstop — which was silently not applying on the driver path. Drivers saw
// every city's products merged into one list (e.g. both "B MILK" and "B",
// "LASSI" and "L"), and could have delivered against another city's product.
describe("driver sheet city isolation (dev DB)", () => {
  it("never includes another city's products in the sheet", async () => {
    const sheet = await getDriverSheet(vehicleId, cityId, routeId, "2027-01-16");
    expect(sheet).not.toBeNull();

    const customer = sheet!.customers.find((c) => c.customerId === customerId);
    expect(customer).toBeDefined();

    const productIds = customer!.products.map((p) => p.productId);
    expect(productIds).toContain(productId);
    expect(productIds).not.toContain(otherCityProductId);
  });

  // The app has nowhere else to get a readable product name from: in some
  // cities the code AND the shortName are both a single letter, so a sheet
  // without `name` left the driver reading a column of bare letters.
  it("sends a full product name, not just the code", async () => {
    const sheet = await getDriverSheet(vehicleId, cityId, routeId, "2027-01-16");
    const product = sheet!.customers
      .find((c) => c.customerId === customerId)!
      .products.find((p) => p.productId === productId);

    expect(product!.name).toBeTruthy();
    expect(product!.name.trim().length).toBeGreaterThan(0);
  });

  it("returns no sheet when the route is asked for under the wrong city", async () => {
    const sheet = await getDriverSheet(vehicleId, otherCityId, routeId, "2027-01-16");
    expect(sheet).toBeNull();
  });

  it("rejects a save that references another city's product instead of writing a cross-city row", async () => {
    const result = await saveDriverLine(vehicleId, cityId, routeId, customerId, "2027-01-29", {
      skipped: false,
      products: [{ productId: otherCityProductId, quantity: 3, rateSnapshot: 99 }],
    });
    expect(result.ok).toBe(false);

    // And nothing was persisted for that product.
    const leaked = await rawPrisma.dailyRouteEntryLineProduct.count({
      where: { productId: otherCityProductId },
    });
    expect(leaked).toBe(0);
  });
});

describe("saveDriverLine location backfill (dev DB)", () => {
  it("captures location on the first non-skipped save and never overwrites it on later saves", async () => {
    await rawPrisma.customer.update({ where: { id: customerId }, data: { latitude: null, longitude: null } });

    const first = await saveDriverLine(vehicleId, cityId, routeId, customerId, "2027-01-20", {
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
    const second = await saveDriverLine(vehicleId, cityId, routeId, customerId, "2027-01-21", {
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

    const result = await saveDriverLine(vehicleId, cityId, routeId, customerId, "2027-01-25", {
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

    const result = await saveDriverLine(vehicleId, cityId, routeId, customerId, "2027-01-27", {
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

    const result = await saveDriverLine(vehicleId, cityId, routeId, customerId, "2027-01-28", {
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

// Last month's issued-but-unpaid bill, surfaced on the driver's customer card
// so they can nudge at the door.
//
// GENERATED only: bills are generated at month end and handed out on the 1st,
// so GENERATED means the customer physically has it. DRAFT was never issued —
// asking for payment on it would be asking against a bill they've never seen.
// LOCKED means the office already collected.
describe("driver sheet previous-month bill (dev DB)", () => {
  const previousMonth = new Date(Date.UTC(2026, 11, 1)); // Dec 2026
  const sheetDate = "2027-01-15"; // so previous month is Dec 2026

  async function setBill(status: "DRAFT" | "GENERATED" | "LOCKED", closing: number) {
    await rawPrisma.monthlyBill.deleteMany({ where: { customerId, billingMonth: previousMonth } });
    await rawPrisma.monthlyBill.create({
      data: {
        customerId,
        routeId,
        billingMonth: previousMonth,
        openingBalance: 0,
        deliveryAmount: closing,
        paymentAmount: 0,
        closingBalance: closing,
        status,
        generatedAt: status === "DRAFT" ? null : new Date(),
      },
    });
  }

  afterAll(async () => {
    await rawPrisma.monthlyBill.deleteMany({ where: { customerId, billingMonth: previousMonth } });
  });

  it("shows an unpaid GENERATED bill from the previous month", async () => {
    await setBill("GENERATED", 450);

    const sheet = await getDriverSheet(vehicleId, cityId, routeId, sheetDate);
    const customer = sheet!.customers.find((entry) => entry.customerId === customerId);

    expect(customer?.previousBill).not.toBeNull();
    expect(customer?.previousBill?.outstanding).toBe("450");
    expect(customer?.previousBill?.month).toBe("2026-12");
  });

  it("hides a LOCKED bill — the office already collected it", async () => {
    await setBill("LOCKED", 450);

    const sheet = await getDriverSheet(vehicleId, cityId, routeId, sheetDate);
    expect(sheet!.customers.find((entry) => entry.customerId === customerId)?.previousBill).toBeNull();
  });

  it("hides a DRAFT bill — it was never issued to the customer", async () => {
    await setBill("DRAFT", 450);

    const sheet = await getDriverSheet(vehicleId, cityId, routeId, sheetDate);
    expect(sheet!.customers.find((entry) => entry.customerId === customerId)?.previousBill).toBeNull();
  });

  it("hides a fully-paid bill even when still GENERATED", async () => {
    await setBill("GENERATED", 0);

    const sheet = await getDriverSheet(vehicleId, cityId, routeId, sheetDate);
    expect(sheet!.customers.find((entry) => entry.customerId === customerId)?.previousBill).toBeNull();
  });

  it("does not disturb the recent-order prefill", async () => {
    // Regression guard: the bill query sits in the same Promise.all as the
    // delivery-history query, and getting that order wrong silently swapped the
    // two — dues broke AND every quantity suggestion did.
    await setBill("GENERATED", 450);

    const sheet = await getDriverSheet(vehicleId, cityId, routeId, "2027-01-16");
    const product = sheet!.customers
      .find((entry) => entry.customerId === customerId)
      ?.products.find((entry) => entry.productId === productId);

    expect(product?.defaultQty).toBe("5");
  });
});

// Money collected at the door.
describe("recordDriverPayment (dev DB)", () => {
  afterAll(async () => {
    await rawPrisma.payment.deleteMany({ where: { customerId } });
  });

  it("records as PENDING — a driver's claim, never a confirmed receipt", async () => {
    await rawPrisma.payment.deleteMany({ where: { customerId } });
    const paymentId = crypto.randomUUID();

    const result = await recordDriverPayment(vehicleId, cityId, routeId, {
      paymentId,
      customerId,
      amount: 250,
      mode: "CASH",
      paidOn: "2027-01-15",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payment.status).toBe("PENDING");
    }

    // PENDING matters beyond the label: the collection ledger counts only
    // VERIFIED payments, so this must not reduce what the customer owes until
    // the office confirms it.
    const stored = await rawPrisma.payment.findUnique({ where: { id: paymentId } });
    expect(stored?.status).toBe("PENDING");
    expect(Number(stored?.amount)).toBe(250);
  });

  it("is idempotent — replaying the same payment id does not take the money twice", async () => {
    await rawPrisma.payment.deleteMany({ where: { customerId } });
    const paymentId = crypto.randomUUID();
    const input = { paymentId, customerId, amount: 100, mode: "UPI" as const, paidOn: "2027-01-15" };

    await recordDriverPayment(vehicleId, cityId, routeId, input);
    await recordDriverPayment(vehicleId, cityId, routeId, input);
    await recordDriverPayment(vehicleId, cityId, routeId, input);

    const all = await rawPrisma.payment.findMany({ where: { customerId } });
    expect(all).toHaveLength(1);
    expect(Number(all[0].amount)).toBe(100);
  });

  it("a replay cannot alter the amount after the fact", async () => {
    await rawPrisma.payment.deleteMany({ where: { customerId } });
    const paymentId = crypto.randomUUID();

    await recordDriverPayment(vehicleId, cityId, routeId, {
      paymentId, customerId, amount: 100, mode: "CASH", paidOn: "2027-01-15",
    });
    await recordDriverPayment(vehicleId, cityId, routeId, {
      paymentId, customerId, amount: 9999, mode: "CASH", paidOn: "2027-01-15",
    });

    const stored = await rawPrisma.payment.findUnique({ where: { id: paymentId } });
    expect(Number(stored?.amount)).toBe(100);
  });

  it("refuses a customer from another city", async () => {
    const result = await recordDriverPayment(vehicleId, otherCityId, routeId, {
      paymentId: crypto.randomUUID(), customerId, amount: 50, mode: "CASH", paidOn: "2027-01-15",
    });

    expect(result.ok).toBe(false);
  });

  it("refuses a zero or negative amount", async () => {
    const result = await recordDriverPayment(vehicleId, cityId, routeId, {
      paymentId: crypto.randomUUID(), customerId, amount: 0, mode: "CASH", paidOn: "2027-01-15",
    });

    expect(result.ok).toBe(false);
  });
});

describe("updateDriverCustomerMobile (dev DB)", () => {
  it("updates the number and can clear it", async () => {
    const set = await updateDriverCustomerMobile(cityId, customerId, " 9876543210 ");
    expect(set.ok).toBe(true);
    if (set.ok) expect(set.customer.mobile).toBe("9876543210");

    const cleared = await updateDriverCustomerMobile(cityId, customerId, null);
    if (cleared.ok) expect(cleared.customer.mobile).toBeNull();
  });

  it("refuses a customer from another city", async () => {
    const result = await updateDriverCustomerMobile(otherCityId, customerId, "9876543210");
    expect(result.ok).toBe(false);
  });
});
