import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getEligibleArchiveCandidates } from "@/lib/archive/eligibility";

const prisma = new PrismaClient();
const suffix = Date.now().toString().slice(-8);

let cityId: string;
let customerId: string;
let customer2Id: string;

// Four routes, one per scenario, so each test only has to look for its own
// route in the candidate list rather than untangling shared state.
let routeAllLockedOld: string; // eligible: every bill LOCKED, locked >60 days ago
let routeAllLockedRecent: string; // not eligible: LOCKED, but inside the grace period
let routePartiallyLocked: string; // not eligible: one bill still DRAFT
let routeNoEntries: string; // not eligible: LOCKED+old, but zero daily entries to archive

const OLD_MONTH = new Date("2020-01-01T00:00:00.000Z");
const RECENT_MONTH = new Date("2020-02-01T00:00:00.000Z");
const PARTIAL_MONTH = new Date("2020-03-01T00:00:00.000Z");
const EMPTY_MONTH = new Date("2020-04-01T00:00:00.000Z");

async function makeRoute(code: string) {
  const route = await prisma.route.create({
    data: { cityId, code: `${code}${suffix}`, name: `Eligibility Test ${code}`, shift: "MORNING" },
  });
  return route.id;
}

async function makeLockedBill(
  routeId: string,
  billingMonth: Date,
  updatedAt: Date,
  status: "LOCKED" | "DRAFT",
  billCustomerId: string = customerId,
) {
  const bill = await prisma.monthlyBill.create({
    data: {
      customerId: billCustomerId,
      routeId,
      billingMonth,
      openingBalance: 0,
      deliveryAmount: 0,
      paymentAmount: 0,
      closingBalance: 0,
      status,
    },
  });
  // updatedAt is managed by Prisma on write, so it has to be forced via a
  // raw update to simulate "locked N days ago" instead of "locked just now".
  await prisma.$executeRawUnsafe(
    `UPDATE "MonthlyBill" SET "updatedAt" = $1 WHERE "id" = $2::uuid`,
    updatedAt,
    bill.id,
  );
}

async function addEntry(routeId: string, billingMonth: Date) {
  const entry = await prisma.dailyRouteEntry.create({
    data: { routeId, entryDate: new Date(billingMonth), syncStatus: "DRAFT" },
  });
  await prisma.dailyRouteEntryLine.create({
    data: { entryId: entry.id, customerId, sequenceNo: 1, skipped: false },
  });
}

const eightyDaysAgo = new Date(Date.now() - 80 * 24 * 60 * 60 * 1000);
const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  const city = await prisma.city.create({ data: { code: `EL${suffix}`, name: `Eligibility Test City ${suffix}` } });
  cityId = city.id;

  const customer = await prisma.customer.create({
    data: { cityId, code: `ELC${suffix}`, name: "Eligibility Test Customer", openingBalance: 0 },
  });
  customerId = customer.id;

  const customer2 = await prisma.customer.create({
    data: { cityId, code: `ELC2${suffix}`, name: "Eligibility Test Customer 2", openingBalance: 0 },
  });
  customer2Id = customer2.id;

  routeAllLockedOld = await makeRoute("OLD");
  routeAllLockedRecent = await makeRoute("RECENT");
  routePartiallyLocked = await makeRoute("PARTIAL");
  routeNoEntries = await makeRoute("EMPTY");

  await makeLockedBill(routeAllLockedOld, OLD_MONTH, eightyDaysAgo, "LOCKED");
  await addEntry(routeAllLockedOld, OLD_MONTH);

  await makeLockedBill(routeAllLockedRecent, RECENT_MONTH, tenDaysAgo, "LOCKED");
  await addEntry(routeAllLockedRecent, RECENT_MONTH);

  await makeLockedBill(routePartiallyLocked, PARTIAL_MONTH, eightyDaysAgo, "LOCKED", customerId);
  await makeLockedBill(routePartiallyLocked, PARTIAL_MONTH, eightyDaysAgo, "DRAFT", customer2Id);
  await addEntry(routePartiallyLocked, PARTIAL_MONTH);

  await makeLockedBill(routeNoEntries, EMPTY_MONTH, eightyDaysAgo, "LOCKED");
  // deliberately no daily entries for this one
});

afterAll(async () => {
  const routeIds = [routeAllLockedOld, routeAllLockedRecent, routePartiallyLocked, routeNoEntries];
  await prisma.dailyRouteEntryLine.deleteMany({ where: { entry: { routeId: { in: routeIds } } } });
  await prisma.dailyRouteEntry.deleteMany({ where: { routeId: { in: routeIds } } });
  await prisma.monthlyBill.deleteMany({ where: { routeId: { in: routeIds } } });
  await prisma.route.deleteMany({ where: { id: { in: routeIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: [customerId, customer2Id] } } });
  await prisma.city.deleteMany({ where: { id: cityId } });
  await prisma.$disconnect();
});

describe("getEligibleArchiveCandidates", () => {
  it("includes a route/month fully LOCKED and past the grace period", async () => {
    const candidates = await getEligibleArchiveCandidates();
    const match = candidates.find((c) => c.routeId === routeAllLockedOld);

    expect(match).toBeDefined();
    expect(match?.entryCount).toBe(1);
  });

  it("excludes a route/month LOCKED but still inside the 60-day grace period", async () => {
    const candidates = await getEligibleArchiveCandidates();
    expect(candidates.some((c) => c.routeId === routeAllLockedRecent)).toBe(false);
  });

  it("excludes a route/month where any bill is not yet LOCKED", async () => {
    const candidates = await getEligibleArchiveCandidates();
    expect(candidates.some((c) => c.routeId === routePartiallyLocked)).toBe(false);
  });

  it("excludes a route/month with no daily entries to archive, even if fully locked and old", async () => {
    const candidates = await getEligibleArchiveCandidates();
    expect(candidates.some((c) => c.routeId === routeNoEntries)).toBe(false);
  });
});
