// Seeds the DEV database with the exact scenario the billing change is about:
// one customer on a MORNING + an EVENING route, delivered on both — including
// on the SAME day, which is what exercises the calendar merge.
//
// Also uses a deliberately long customer code and name so the printed bill
// header can be eyeballed at its worst case.
//
// Run:    npm run db:seed-billing-test
// Undo:   npm run db:seed-billing-test -- --cleanup
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Whichever city actually has an active product catalogue — dev has an empty
// "Rohtak" alongside the populated one, and seeding into the empty one would
// produce a scenario with nothing to deliver. Override with an argument.
const CITY_NAME = process.argv.find((arg) => arg.startsWith("--city="))?.slice("--city=".length) ?? null;
const MORNING_CODE = "ZZ-TEST-M";
const EVENING_CODE = "ZZ-TEST-E";
const CUSTOMER_CODE = "ROHTAKCID0145X";
const CUSTOMER_NAME = "B-11 SEC-34 UPAR WALA PORTION";

async function cleanup(cityId) {
  const routes = await prisma.route.findMany({
    where: { cityId, code: { in: [MORNING_CODE, EVENING_CODE] } },
    select: { id: true },
  });
  const routeIds = routes.map((route) => route.id);
  if (routeIds.length > 0) {
    await prisma.monthlyBillItem.deleteMany({ where: { monthlyBill: { routeId: { in: routeIds } } } });
    await prisma.monthlyBill.deleteMany({ where: { routeId: { in: routeIds } } });
    await prisma.dailyRouteEntryLineProduct.deleteMany({
      where: { line: { entry: { routeId: { in: routeIds } } } },
    });
    await prisma.dailyRouteEntryLine.deleteMany({ where: { entry: { routeId: { in: routeIds } } } });
    await prisma.dailyRouteEntry.deleteMany({ where: { routeId: { in: routeIds } } });
    await prisma.monthlyRouteCustomerSequence.deleteMany({ where: { routeId: { in: routeIds } } });
    await prisma.route.deleteMany({ where: { id: { in: routeIds } } });
  }
  await prisma.customer.deleteMany({ where: { cityId, code: CUSTOMER_CODE } });
  console.log("Cleaned up ZZ-TEST routes + test customer.");
}

async function main() {
  const city = CITY_NAME
    ? await prisma.city.findFirst({ where: { name: CITY_NAME }, select: { id: true, name: true } })
    : await prisma.city.findFirst({
        where: { products: { some: { isActive: true, showInDailyEntry: true } } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });
  if (!city) {
    throw new Error(
      CITY_NAME
        ? `City "${CITY_NAME}" not found in this database.`
        : "No city in this database has an active product catalogue.",
    );
  }

  if (process.argv.includes("--cleanup")) {
    await cleanup(city.id);
    return;
  }

  await cleanup(city.id);

  const products = await prisma.product.findMany({
    where: { cityId: city.id, isActive: true, showInDailyEntry: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, defaultRate: true },
  });
  if (products.length === 0) throw new Error("No active products in this city.");
  const product = products[0];

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthLabel = monthStart.toISOString().slice(0, 7);

  // Both test rounds run on ONE vehicle, mirroring production: every vehicle
  // covers a morning and an evening round, and a customer on both is billed on
  // only one of them. A route without a vehicle no longer exists — the column
  // is NOT NULL, and the collections sheet is organised by vehicle.
  const vehicle = await prisma.vehicle.findFirst({
    where: { cityId: city.id, isActive: true },
    select: { id: true, code: true },
  });
  if (!vehicle) throw new Error("No active vehicle in this city — a route needs one.");

  const morning = await prisma.route.create({
    data: {
      cityId: city.id,
      code: MORNING_CODE,
      name: "Billing Test Morning",
      shift: "MORNING",
      vehicleId: vehicle.id,
    },
  });
  const evening = await prisma.route.create({
    data: {
      cityId: city.id,
      code: EVENING_CODE,
      name: "Billing Test Evening",
      shift: "EVENING",
      vehicleId: vehicle.id,
    },
  });

  const customer = await prisma.customer.create({
    data: {
      cityId: city.id,
      code: CUSTOMER_CODE,
      name: CUSTOMER_NAME,
      area: "SECTOR 34",
      mobile: "9990001111",
      openingBalance: 0,
    },
  });

  // On BOTH routes for the month. The morning route carries the bill.
  await prisma.monthlyRouteCustomerSequence.create({
    data: {
      routeId: morning.id,
      customerId: customer.id,
      sequenceMonth: monthStart,
      sequenceNo: 1,
      status: "ACTIVE",
      billsHere: true,
    },
  });
  await prisma.monthlyRouteCustomerSequence.create({
    data: {
      routeId: evening.id,
      customerId: customer.id,
      sequenceMonth: monthStart,
      sequenceNo: 1,
      status: "ACTIVE",
      billsHere: false,
    },
  });

  const rate = Number(product.defaultRate);
  // Day 2 is delivered on BOTH routes — the case that previously lost one of
  // the two lines. Day 3 morning only, day 4 evening only.
  const deliveries = [
    { routeId: morning.id, day: 2, qty: 2 },
    { routeId: evening.id, day: 2, qty: 3 },
    { routeId: morning.id, day: 3, qty: 1 },
    { routeId: evening.id, day: 4, qty: 4 },
  ];

  for (const delivery of deliveries) {
    const entryDate = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), delivery.day));
    const entry = await prisma.dailyRouteEntry.upsert({
      where: { routeId_entryDate: { routeId: delivery.routeId, entryDate } },
      update: {},
      create: { routeId: delivery.routeId, entryDate, syncStatus: "SYNCED" },
      select: { id: true },
    });
    const line = await prisma.dailyRouteEntryLine.upsert({
      where: { entryId_customerId: { entryId: entry.id, customerId: customer.id } },
      update: {},
      create: { entryId: entry.id, customerId: customer.id, sequenceNo: 1, skipped: false },
      select: { id: true },
    });
    await prisma.dailyRouteEntryLineProduct.upsert({
      where: { lineId_productId: { lineId: line.id, productId: product.id } },
      update: { quantity: delivery.qty, rateSnapshot: rate },
      create: { lineId: line.id, productId: product.id, quantity: delivery.qty, rateSnapshot: rate },
    });
  }

  const totalQty = deliveries.reduce((sum, delivery) => sum + delivery.qty, 0);
  console.log(`Seeded into "${city.name}" for ${monthLabel}:

  Customer   ${CUSTOMER_CODE} — ${CUSTOMER_NAME}
  Routes     ${MORNING_CODE} (bills here) + ${EVENING_CODE}
  Product    ${product.code} @ ${rate}

  Deliveries  day 2: ${deliveries[0].qty} (morning) + ${deliveries[1].qty} (evening)  <-- same day, both routes
              day 3: ${deliveries[2].qty} (morning)
              day 4: ${deliveries[3].qty} (evening)

  Expected ONE bill on ${MORNING_CODE}: ${totalQty} x ${rate} = ${totalQty * rate}
  Expected day-2 calendar cell: ${deliveries[0].qty + deliveries[1].qty} (NOT ${deliveries[1].qty})
`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
