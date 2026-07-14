import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { archiveStorageKey, buildArchiveExport, monthBounds } from "@/lib/archive/export";
import { parseArchiveBuffer } from "@/lib/archive/parse";
import { gunzipSync } from "node:zlib";

const prisma = new PrismaClient();
const BILLING_MONTH = new Date("2027-03-01T00:00:00.000Z");

let cityId: string;
let routeId: string;
let customerId: string;
let productId: string;

beforeAll(async () => {
  const suffix = Date.now().toString().slice(-8);
  const city = await prisma.city.create({ data: { code: `XA${suffix}`, name: `Archive Test City ${suffix}` } });
  cityId = city.id;

  const route = await prisma.route.create({
    data: { cityId, code: `AR${suffix}`, name: "Archive Test Route", shift: "MORNING" },
  });
  routeId = route.id;

  const customer = await prisma.customer.create({
    data: { cityId, code: `AC${suffix}`, name: "Archive Test Customer", openingBalance: 0 },
  });
  customerId = customer.id;

  const product = await prisma.product.create({
    data: { cityId, code: `AP${suffix}`, name: "Archive Test Product", unit: "L", defaultRate: "45.5" },
  });
  productId = product.id;

  await prisma.monthlyRouteCustomerSequence.create({
    data: { routeId, customerId, sequenceMonth: BILLING_MONTH, sequenceNo: 1, status: "ACTIVE" },
  });

  const entry = await prisma.dailyRouteEntry.create({
    data: { routeId, entryDate: new Date("2027-03-05T00:00:00.000Z"), syncStatus: "DRAFT" },
  });
  const line = await prisma.dailyRouteEntryLine.create({
    data: { entryId: entry.id, customerId, sequenceNo: 1, skipped: false },
  });
  // A deliberately awkward decimal, to prove exact round-tripping (not
  // lossy float coercion) through JSON -> gzip -> parse.
  await prisma.dailyRouteEntryLineProduct.create({
    data: { lineId: line.id, productId, quantity: "3.127", rateSnapshot: "45.50" },
  });
});

afterAll(async () => {
  await prisma.dailyRouteEntryLineProduct.deleteMany({ where: { line: { entry: { routeId } } } });
  await prisma.dailyRouteEntryLine.deleteMany({ where: { entry: { routeId } } });
  await prisma.dailyRouteEntry.deleteMany({ where: { routeId } });
  await prisma.monthlyRouteCustomerSequence.deleteMany({ where: { routeId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.route.deleteMany({ where: { id: routeId } });
  await prisma.city.deleteMany({ where: { id: cityId } });
  await prisma.$disconnect();
});

describe("monthBounds", () => {
  it("spans exactly one calendar month in UTC", () => {
    const { start, end } = monthBounds(new Date("2027-03-01T00:00:00.000Z"));
    expect(start.toISOString()).toBe("2027-03-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-04-01T00:00:00.000Z");
  });
});

describe("archiveStorageKey", () => {
  it("builds a stable, predictable object key", () => {
    expect(archiveStorageKey("ROHTAK", "ROUTE-01-M", new Date("2027-03-01T00:00:00.000Z"))).toBe(
      "daily-entries/ROHTAK/ROUTE-01-M/2027-03.jsonl.gz",
    );
  });
});

describe("buildArchiveExport + parseArchiveBuffer round-trip", () => {
  it("exports real DB rows and reads them back with exact counts, decimals, and a stable checksum", async () => {
    const result = await buildArchiveExport(routeId, BILLING_MONTH);

    expect(result.entryCount).toBe(1);
    expect(result.lineCount).toBe(1);
    expect(result.productEntryCount).toBe(1);
    expect(result.sequenceCount).toBe(1);

    const parsed = parseArchiveBuffer(result.buffer);

    expect(parsed.checksum).toBe(result.checksum);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.productEntries).toHaveLength(1);
    expect(parsed.sequences).toHaveLength(1);

    // The exact point of using Decimal's own toJSON() instead of Number() —
    // no float coercion, the original precision survives untouched.
    expect(parsed.productEntries[0]?.quantity).toBe("3.127");
    expect(parsed.productEntries[0]?.rateSnapshot).toBe("45.5");

    // The buffer actually is gzip — decompresses to the same JSONL the
    // checksum was computed over.
    const decompressed = gunzipSync(result.buffer).toString("utf-8");
    expect(decompressed).toBe(parsed.jsonl);
  });

  it("returns zero counts for a month with no data, without erroring", async () => {
    const result = await buildArchiveExport(routeId, new Date("2030-01-01T00:00:00.000Z"));
    expect(result.entryCount).toBe(0);
    expect(result.lineCount).toBe(0);
    expect(result.productEntryCount).toBe(0);
    expect(result.sequenceCount).toBe(0);
  });
});
