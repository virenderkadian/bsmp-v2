import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  existingBillingKeys,
  resolveRestoredSequenceFlags,
  sequenceBillingKey,
} from "@/lib/archive/restore-sequences";

const MONTH_ISO = "2029-08-01T00:00:00.000Z";

function archivedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    routeId: crypto.randomUUID(),
    customerId: "cust-1",
    sequenceMonth: MONTH_ISO,
    sequenceNo: 1,
    status: "ACTIVE",
    ...overrides,
  };
}

describe("sequenceBillingKey", () => {
  it("normalises an ISO string date to a day", () => {
    expect(sequenceBillingKey(archivedRow())).toBe("cust-1:2029-08-01");
  });

  it("treats a Date and its ISO string as the same key", () => {
    expect(sequenceBillingKey(archivedRow({ sequenceMonth: new Date(MONTH_ISO) }))).toBe(
      sequenceBillingKey(archivedRow()),
    );
  });

  it("returns null for a row it can't identify, rather than a bogus key", () => {
    expect(sequenceBillingKey(archivedRow({ customerId: undefined }))).toBeNull();
    expect(sequenceBillingKey(archivedRow({ sequenceMonth: "not-a-date" }))).toBeNull();
  });
});

describe("resolveRestoredSequenceFlags", () => {
  it("lets only the first of several routes for one customer carry the bill", () => {
    const resolved = resolveRestoredSequenceFlags(
      [archivedRow({ billsHere: true }), archivedRow({ billsHere: true })],
      [],
    );

    expect(resolved.map((row) => row.billsHere)).toEqual([true, false]);
  });

  it("handles an archive written BEFORE billsHere existed", () => {
    // No billsHere at all: the column default is true, so every restored row
    // would claim the flag and the second insert would abort the restore.
    const resolved = resolveRestoredSequenceFlags([archivedRow(), archivedRow()], []);

    expect(resolved.map((row) => row.billsHere)).toEqual([true, false]);
  });

  it("yields to a billing row already in the database", () => {
    const resolved = resolveRestoredSequenceFlags(
      [archivedRow({ billsHere: true })],
      ["cust-1:2029-08-01"],
    );

    // The customer is already billed somewhere; restoring must not move that.
    expect(resolved[0].billsHere).toBe(false);
  });

  it("keeps every row — a row that can't hold the flag is still restored", () => {
    const resolved = resolveRestoredSequenceFlags(
      [archivedRow({ billsHere: true }), archivedRow({ billsHere: true })],
      ["cust-1:2029-08-01"],
    );

    expect(resolved).toHaveLength(2);
    expect(resolved.every((row) => row.billsHere === false)).toBe(true);
  });

  it("keeps customers and months independent", () => {
    const resolved = resolveRestoredSequenceFlags(
      [
        archivedRow({ billsHere: true }),
        archivedRow({ customerId: "cust-2", billsHere: true }),
        archivedRow({ sequenceMonth: "2029-09-01T00:00:00.000Z", billsHere: true }),
      ],
      [],
    );

    expect(resolved.map((row) => row.billsHere)).toEqual([true, true, true]);
  });

  it("respects an explicit false rather than promoting it", () => {
    const resolved = resolveRestoredSequenceFlags([archivedRow({ billsHere: false })], []);

    expect(resolved[0].billsHere).toBe(false);
  });

  it("does not let an INACTIVE row consume the claim", () => {
    // Inactive rows sit outside the partial index, so they can't collide and
    // must not deny the flag to a real active route.
    const resolved = resolveRestoredSequenceFlags(
      [archivedRow({ status: "INACTIVE", billsHere: true }), archivedRow({ billsHere: true })],
      [],
    );

    expect(resolved[1].billsHere).toBe(true);
  });
});

describe("existingBillingKeys", () => {
  it("formats database rows into the same key shape", () => {
    expect(
      existingBillingKeys([{ customerId: "cust-1", sequenceMonth: new Date(MONTH_ISO) }]),
    ).toEqual(["cust-1:2029-08-01"]);
  });
});

// Proves the fix against the real constraint: the old code path (inserting the
// archived rows verbatim) throws, and the resolved rows insert cleanly.
describe("restore against the real partial unique index (dev DB)", () => {
  const prisma = new PrismaClient();
  const sequenceMonth = new Date(MONTH_ISO);

  let cityId: string;
  let routeAId: string;
  let routeBId: string;
  let realCustomerId: string;

  beforeAll(async () => {
    const suffix = Date.now().toString().slice(-8);
    const city = await prisma.city.create({ data: { code: `RS${suffix}`, name: `RestoreSeq ${suffix}` } });
    cityId = city.id;
    const routeA = await prisma.route.create({
      data: { cityId, code: `RSA-${suffix}`, name: "Restore A", shift: "MORNING" },
    });
    routeAId = routeA.id;
    const routeB = await prisma.route.create({
      data: { cityId, code: `RSB-${suffix}`, name: "Restore B", shift: "EVENING" },
    });
    routeBId = routeB.id;
    const customer = await prisma.customer.create({
      data: { cityId, code: `RSC-${suffix}`, name: "Restore Customer", openingBalance: 0 },
    });
    realCustomerId = customer.id;
  });

  afterAll(async () => {
    await prisma.monthlyRouteCustomerSequence.deleteMany({ where: { routeId: { in: [routeAId, routeBId] } } });
    await prisma.route.deleteMany({ where: { id: { in: [routeAId, routeBId] } } });
    await prisma.customer.deleteMany({ where: { cityId } });
    await prisma.city.deleteMany({ where: { id: cityId } });
    await prisma.$disconnect();
  });

  it("the UNFIXED path really does fail — two archived routes both claiming the flag", async () => {
    const archived = [
      { routeId: routeAId, customerId: realCustomerId, sequenceMonth, sequenceNo: 1, status: "ACTIVE" as const, billsHere: true },
      { routeId: routeBId, customerId: realCustomerId, sequenceMonth, sequenceNo: 1, status: "ACTIVE" as const, billsHere: true },
    ];

    await expect(
      prisma.$transaction(async (tx) => {
        for (const row of archived) {
          await tx.monthlyRouteCustomerSequence.create({ data: row });
        }
      }),
    ).rejects.toThrow();

    await prisma.monthlyRouteCustomerSequence.deleteMany({ where: { customerId: realCustomerId } });
  });

  it("restores both routes cleanly once the flags are resolved", async () => {
    const archived = [
      { routeId: routeAId, customerId: realCustomerId, sequenceMonth: MONTH_ISO, sequenceNo: 1, status: "ACTIVE" },
      { routeId: routeBId, customerId: realCustomerId, sequenceMonth: MONTH_ISO, sequenceNo: 1, status: "ACTIVE" },
    ];

    const resolved = resolveRestoredSequenceFlags(archived, []);

    await prisma.$transaction(async (tx) => {
      for (const row of resolved) {
        await tx.monthlyRouteCustomerSequence.create({
          data: { ...row, sequenceMonth: new Date(row.sequenceMonth as string) } as never,
        });
      }
    });

    const rows = await prisma.monthlyRouteCustomerSequence.findMany({
      where: { customerId: realCustomerId },
      select: { routeId: true, billsHere: true },
    });

    // Both routes restored, exactly one billing.
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.billsHere)).toHaveLength(1);

    await prisma.monthlyRouteCustomerSequence.deleteMany({ where: { customerId: realCustomerId } });
  });

  it("does not steal the flag from a route already billing the customer", async () => {
    await prisma.monthlyRouteCustomerSequence.create({
      data: { routeId: routeAId, customerId: realCustomerId, sequenceMonth, sequenceNo: 1, status: "ACTIVE", billsHere: true },
    });

    const existing = await prisma.monthlyRouteCustomerSequence.findMany({
      where: { customerId: realCustomerId, status: "ACTIVE", billsHere: true },
      select: { customerId: true, sequenceMonth: true },
    });

    const resolved = resolveRestoredSequenceFlags(
      [{ routeId: routeBId, customerId: realCustomerId, sequenceMonth: MONTH_ISO, sequenceNo: 2, status: "ACTIVE" }],
      existingBillingKeys(existing),
    );

    await prisma.monthlyRouteCustomerSequence.create({
      data: { ...resolved[0], sequenceMonth } as never,
    });

    const rows = await prisma.monthlyRouteCustomerSequence.findMany({
      where: { customerId: realCustomerId },
      select: { routeId: true, billsHere: true },
    });

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.billsHere)?.routeId).toBe(routeAId);
  });
});
