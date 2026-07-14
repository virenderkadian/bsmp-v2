import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { setCityContext } from "@/lib/city-context";

// Exercises the actual guard used in production (src/lib/prisma.ts's
// $extends), not a reimplementation of it — this is the real defense
// against the failure mode the user asked for a backstop against: a query
// against a city-scoped model that forgets its own `where: { cityId }`.
// Hits the real dev database (same as every other verification this
// session), so it creates and tears down its own throwaway cities.

const rawPrisma = new PrismaClient();

let cityAId: string;
let cityBId: string;
let customerAId: string;
let customerBId: string;

beforeAll(async () => {
  const suffix = Date.now().toString().slice(-8);
  const cityA = await rawPrisma.city.create({ data: { code: `TA${suffix}`, name: `Test City A ${suffix}` } });
  const cityB = await rawPrisma.city.create({ data: { code: `TB${suffix}`, name: `Test City B ${suffix}` } });
  cityAId = cityA.id;
  cityBId = cityB.id;

  const customerA = await rawPrisma.customer.create({
    data: { cityId: cityAId, code: "CSCOPE-A", name: "City Scope Test Customer A", openingBalance: 0 },
  });
  const customerB = await rawPrisma.customer.create({
    data: { cityId: cityBId, code: "CSCOPE-B", name: "City Scope Test Customer B", openingBalance: 0 },
  });
  customerAId = customerA.id;
  customerBId = customerB.id;
});

afterAll(async () => {
  await rawPrisma.customer.deleteMany({ where: { id: { in: [customerAId, customerBId] } } });
  await rawPrisma.city.deleteMany({ where: { id: { in: [cityAId, cityBId] } } });
  await rawPrisma.$disconnect();
});

describe("city-scope guard (src/lib/prisma.ts)", () => {
  it("narrows an unscoped findMany to only the current city's rows", async () => {
    setCityContext(cityAId);

    // Deliberately no `where` at all — this is exactly the bug class the
    // guard exists to catch.
    const customers = await prisma.customer.findMany({
      where: { code: { in: ["CSCOPE-A", "CSCOPE-B"] } },
    });

    expect(customers.map((c) => c.id)).toContain(customerAId);
    expect(customers.map((c) => c.id)).not.toContain(customerBId);
  });

  it("blocks reading another city's row by id via findUnique", async () => {
    setCityContext(cityAId);

    const foundOwnCity = await prisma.customer.findUnique({ where: { id: customerAId } });
    const foundOtherCity = await prisma.customer.findUnique({ where: { id: customerBId } });

    expect(foundOwnCity?.id).toBe(customerAId);
    expect(foundOtherCity).toBeNull();
  });

  it("does not override an explicit cityId the caller already provided", async () => {
    setCityContext(cityAId);

    // Caller explicitly asks for city B's data — the guard only fills in a
    // *missing* cityId, it never fights a deliberate one.
    const customers = await prisma.customer.findMany({
      where: { cityId: cityBId, code: "CSCOPE-B" },
    });

    expect(customers.map((c) => c.id)).toContain(customerBId);
  });

  it("passes through unscoped when there is no city context at all", async () => {
    setCityContext("");

    const customers = await prisma.customer.findMany({
      where: { code: { in: ["CSCOPE-A", "CSCOPE-B"] } },
    });

    // No context (e.g. a background job) means no restriction is applied —
    // both rows are visible, matching current behavior for non-request code.
    expect(customers.map((c) => c.id).sort()).toEqual([customerAId, customerBId].sort());
  });
});
