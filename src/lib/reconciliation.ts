import { Prisma } from "@prisma/client";
import { getCurrentCityId } from "@/lib/current-city";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";
import {
  summariseCashReport,
  type CashReportDay, computeLeftover, computeLeftoverValue, computeVehicleBalance
} from "@/lib/reconciliation-math";

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateInput: string, days: number) {
  const date = new Date(`${dateInput}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateInput(date);
}

// One row per (entryDate, route, product) — already summed in SQL across
// every line on that route that day, rather than pulled one line/product row
// at a time and summed in JS. See getDeliveryTotals below. productId/quantity
// are nullable: the query LEFT JOINs out from the entry itself, so a route
// that ran but delivered nothing that day (every line skipped, or simply no
// reconciliation-relevant product on it) still produces one row — with no
// product attached — rather than vanishing from the result entirely. Losing
// that row would silently read as "this route never ran", which is a
// different, wrong fact from "it ran and delivered zero".
type DeliveryAggregateRow = {
  entryDate: Date;
  routeId: string;
  routeName: string;
  shift: string;
  vehicleId: string;
  productId: string | null;
  quantity: unknown;
};

// One route's contribution to a vehicle's round: which route it was, and how
// much of each product it delivered.
type RouteDelivery = {
  routeId: string;
  routeName: string;
  quantities: Map<string, number>;
};

// Groups already-summed delivery rows by the vehicle that actually ran them,
// then by shift and date — so a vehicle covering two routes in one shift
// (helping out while another vehicle is off the road) has both counted,
// rather than whichever one happened to be found first.
//
// The vehicle is the entry's own snapshot where it has one, falling back to
// the route's current owner for rows written before that column existed
// (both already resolved in SQL via COALESCE — see getDeliveryTotals).
// Reading the route's CURRENT owner for every entry would mean reassigning a
// route tomorrow silently moves last week's deliveries to another vehicle.
function groupDeliveries(rows: DeliveryAggregateRow[]) {
  const map = new Map<string, RouteDelivery[]>();
  const routesByKey = new Map<string, Map<string, RouteDelivery>>();

  for (const row of rows) {
    const key = `${row.vehicleId}:${row.shift}:${toDateInput(row.entryDate)}`;

    let routesForKey = routesByKey.get(key);
    if (!routesForKey) {
      routesForKey = new Map();
      routesByKey.set(key, routesForKey);
      map.set(key, []);
    }

    let routeDelivery = routesForKey.get(row.routeId);
    if (!routeDelivery) {
      routeDelivery = { routeId: row.routeId, routeName: row.routeName, quantities: new Map() };
      routesForKey.set(row.routeId, routeDelivery);
      map.get(key)!.push(routeDelivery);
    }

    // No product on this entry (every line skipped, or nothing delivered) —
    // the RouteDelivery object above still gets created so hasEntry reads
    // true, there's just nothing to add to its quantities.
    if (row.productId !== null) {
      routeDelivery.quantities.set(row.productId, Number(row.quantity));
    }
  }

  return map;
}

// Delivered quantity per (entryDate, route, product) for every route in the
// city on the given dates — summed in SQL rather than pulling every
// line/product row and summing in JS. That used to be this screen's single
// heaviest query: one row per customer per product per day, chunked across
// Prisma's relation-loading into dozens of separate round trips. This is one
// query, one row per (date, route, product) actually delivered — LEFT JOINed
// from the entry itself so a route that ran with zero deliveries still
// produces a row (see DeliveryAggregateRow above).
async function getDeliveryTotals(cityId: string, dates: Date[]): Promise<DeliveryAggregateRow[]> {
  if (dates.length === 0) {
    return [];
  }

  return prisma.$queryRaw<DeliveryAggregateRow[]>`
    SELECT e."entryDate" AS "entryDate", e."routeId" AS "routeId", r."name" AS "routeName",
      r."shift" AS "shift", COALESCE(e."vehicleId", r."vehicleId") AS "vehicleId",
      dp."productId" AS "productId", SUM(dp.quantity)::numeric AS "quantity"
    FROM "DailyRouteEntry" e
    JOIN "Route" r ON r.id = e."routeId"
    LEFT JOIN "DailyRouteEntryLine" dl ON dl."entryId" = e.id
    LEFT JOIN "DailyRouteEntryLineProduct" dp ON dp."lineId" = dl.id
    WHERE r."cityId" = ${cityId}::uuid AND e."entryDate" IN (${Prisma.join(dates)})
    GROUP BY e."entryDate", e."routeId", r."name", r."shift", COALESCE(e."vehicleId", r."vehicleId"), dp."productId"
  `;
}

// How much of one product came from one particular route. Only interesting
// when a shift has more than one route behind it — otherwise it just repeats
// the shift total.
export type ReconciliationRouteSplit = {
  routeId: string;
  routeName: string;
  quantity: string;
};

export type ReconciliationProductLine = {
  productId: string;
  productName: string;
  // Falls back to the full name when a product has no short form set — used
  // by the WhatsApp share text, which needs "B MILK" rather than "Buffalo
  // Milk" to match how the office already writes these by hand.
  productShortName: string;
  unit: string;
  given: string;
  eveningDelivered: string;
  morningDelivered: string;
  // The shift totals above, broken down by the route each part came from.
  eveningByRoute: ReconciliationRouteSplit[];
  morningByRoute: ReconciliationRouteSplit[];
  returned: string;
  leftover: string;
  rate: string;
  leftoverValue: string;
};

export type ReconciliationRoute = {
  id: string;
  name: string;
  // Whether this route's deliveries have been entered for its date. A shift
  // only counts as done once every route behind it has been — otherwise the
  // delivered total is short and the leftover looks like a shortage that
  // isn't real.
  hasEntry: boolean;
  // True when the route is no longer assigned to this vehicle but did run
  // for it on this date. Kept visible so the figures it contributed can be
  // accounted for rather than appearing from nowhere.
  reassignedAway: boolean;
};

export type ReconciliationCycle = {
  vehicleId: string;
  vehicleCode: string;
  vehicleName: string;
  cycleDate: string;
  eveningDate: string;
  // Every route behind each shift, not just the first one found: a vehicle
  // can cover more than one route in a shift.
  eveningRoutes: ReconciliationRoute[];
  morningRoutes: ReconciliationRoute[];
  hasEveningEntry: boolean;
  hasMorningEntry: boolean;
  hasStockEntry: boolean;
  products: ReconciliationProductLine[];
  cashSaleAmount: string;
  paymentsReceived: string;
  balance: string;
};

export type ReconciliationPayload = {
  dbConnected: boolean;
  cycleDate: string;
  vehicles: Array<{ id: string; code: string; name: string }>;
  reconciliationProducts: Array<{ id: string; name: string; unit: string; defaultRate: string }>;
  cycles: ReconciliationCycle[];
  error?: string;
};

function fallbackPayload(cycleDate: string, error?: string): ReconciliationPayload {
  return {
    dbConnected: false,
    cycleDate,
    vehicles: [],
    reconciliationProducts: [],
    cycles: [],
    error,
  };
}

export async function getReconciliationPayload(input?: { cycleDate?: string }): Promise<ReconciliationPayload> {
  const cycleDate = /^\d{4}-\d{2}-\d{2}$/.test(input?.cycleDate ?? "")
    ? (input!.cycleDate as string)
    : toDateInput(new Date());

  try {
    const cityId = await getCurrentCityId();

    const [vehicles, reconciliationProducts] = await Promise.all([
      withDbTimeout(
        prisma.vehicle.findMany({
          where: { cityId, isActive: true },
          orderBy: { code: "asc" },
          select: {
            id: true,
            code: true,
            name: true,
            routes: {
              where: { isActive: true },
              select: { id: true, name: true, shift: true },
            },
          },
        }),
        "Reconciliation vehicles request",
      ),
      withDbTimeout(
        prisma.product.findMany({
          where: { cityId, includeInReconciliation: true, isActive: true },
          orderBy: { displayOrder: "asc" },
          select: { id: true, name: true, shortName: true, unit: true, defaultRate: true },
        }),
        "Reconciliation products request",
      ),
    ]);

    const reconciliationProductRecords = reconciliationProducts.map((product) => ({
      id: product.id,
      name: product.name,
      unit: product.unit,
      defaultRate: String(product.defaultRate),
    }));

    if (vehicles.length === 0 || reconciliationProducts.length === 0) {
      return {
        dbConnected: true,
        cycleDate,
        vehicles: vehicles.map((vehicle) => ({ id: vehicle.id, code: vehicle.code, name: vehicle.name })),
        reconciliationProducts: reconciliationProductRecords,
        cycles: [],
      };
    }

    const eveningDate = addDays(cycleDate, -1);
    const productIds = reconciliationProducts.map((product) => product.id);
    const vehicleIds = vehicles.map((vehicle) => vehicle.id);

    const [deliveryRows, stockRows, paymentRows] = await Promise.all([
      withDbTimeout(
        // Scoped to the city, not to these vehicles specifically — any extra
        // rows for an inactive vehicle just sit unused in the map below,
        // since `cycles` only ever iterates the already-filtered `vehicles`
        // array. Simpler than threading a vehicleId list into the SQL.
        getDeliveryTotals(cityId, [new Date(eveningDate), new Date(cycleDate)]),
        "Reconciliation entries request",
      ),
      withDbTimeout(
        prisma.vehicleCycleStock.findMany({
          where: { vehicleId: { in: vehicleIds }, productId: { in: productIds }, cycleDate: new Date(cycleDate) },
          select: { vehicleId: true, productId: true, givenQty: true, returnedQty: true, rateSnapshot: true },
        }),
        "Reconciliation stock request",
      ),
      withDbTimeout(
        prisma.vehicleCashSalePayment.findMany({
          where: { vehicleId: { in: vehicleIds }, cycleDate: new Date(cycleDate), status: "VERIFIED" },
          select: { vehicleId: true, amount: true },
        }),
        "Reconciliation payments request",
      ),
    ]);

    const deliveries = groupDeliveries(deliveryRows);

    const paymentsByVehicle = new Map<string, number>();
    paymentRows.forEach((payment) => {
      paymentsByVehicle.set(payment.vehicleId, (paymentsByVehicle.get(payment.vehicleId) ?? 0) + Number(payment.amount));
    });

    // The routes behind one shift: those currently assigned to the vehicle,
    // plus any that actually ran for it that date but have since been handed
    // back. A currently-assigned route with no entry is what makes a shift
    // read as still waiting.
    function shiftRoutes(
      vehicle: (typeof vehicles)[number],
      shift: "EVENING" | "MORNING",
      ran: RouteDelivery[],
    ): ReconciliationRoute[] {
      const assigned = vehicle.routes.filter((route) => route.shift === shift);
      const ranIds = new Set(ran.map((delivery) => delivery.routeId));

      const routes: ReconciliationRoute[] = assigned.map((route) => ({
        id: route.id,
        name: route.name,
        hasEntry: ranIds.has(route.id),
        reassignedAway: false,
      }));

      for (const delivery of ran) {
        if (!assigned.some((route) => route.id === delivery.routeId)) {
          routes.push({
            id: delivery.routeId,
            name: delivery.routeName,
            hasEntry: true,
            reassignedAway: true,
          });
        }
      }

      return routes;
    }

    const cycles: ReconciliationCycle[] = vehicles.map((vehicle) => {
      const eveningRan = deliveries.get(`${vehicle.id}:EVENING:${eveningDate}`) ?? [];
      const morningRan = deliveries.get(`${vehicle.id}:MORNING:${cycleDate}`) ?? [];
      const eveningRoutes = shiftRoutes(vehicle, "EVENING", eveningRan);
      const morningRoutes = shiftRoutes(vehicle, "MORNING", morningRan);

      let hasStockEntry = false;
      let cashSaleAmount = 0;

      const products: ReconciliationProductLine[] = reconciliationProducts.map((product) => {
        const splitFor = (ran: RouteDelivery[]) =>
          ran
            .map((delivery) => ({
              routeId: delivery.routeId,
              routeName: delivery.routeName,
              raw: delivery.quantities.get(product.id) ?? 0,
            }))
            .filter((split) => split.raw > 0);

        const eveningSplit = splitFor(eveningRan);
        const morningSplit = splitFor(morningRan);
        const eveningDelivered = eveningSplit.reduce((sum, split) => sum + split.raw, 0);
        const morningDelivered = morningSplit.reduce((sum, split) => sum + split.raw, 0);
        const stock = stockRows.find((row) => row.vehicleId === vehicle.id && row.productId === product.id);

        if (stock) {
          hasStockEntry = true;
        }

        const given = stock ? Number(stock.givenQty) : 0;
        const returned = stock ? Number(stock.returnedQty) : 0;
        const leftover = computeLeftover({ given, eveningDelivered, morningDelivered, returned });
        // The rate frozen when the stock was recorded, so a later rate change
        // cannot re-price a past cycle. Falls back to today's rate only for
        // rows written before the snapshot existed.
        const rate = stock?.rateSnapshot !== null && stock?.rateSnapshot !== undefined
          ? Number(stock.rateSnapshot)
          : Number(product.defaultRate);
        const leftoverValue = computeLeftoverValue(leftover, rate);
        cashSaleAmount += leftoverValue;

        return {
          productId: product.id,
          productName: product.name,
          productShortName: product.shortName ?? product.name,
          unit: product.unit,
          given: given.toFixed(3),
          eveningDelivered: eveningDelivered.toFixed(3),
          morningDelivered: morningDelivered.toFixed(3),
          eveningByRoute: eveningSplit.map(({ routeId, routeName, raw }) => ({
            routeId,
            routeName,
            quantity: raw.toFixed(3),
          })),
          morningByRoute: morningSplit.map(({ routeId, routeName, raw }) => ({
            routeId,
            routeName,
            quantity: raw.toFixed(3),
          })),
          returned: returned.toFixed(3),
          leftover: leftover.toFixed(3),
          rate: rate.toFixed(2),
          leftoverValue: leftoverValue.toFixed(2),
        };
      });

      const paymentsReceived = paymentsByVehicle.get(vehicle.id) ?? 0;
      const balance = computeVehicleBalance(cashSaleAmount, paymentsReceived);

      return {
        vehicleId: vehicle.id,
        vehicleCode: vehicle.code,
        vehicleName: vehicle.name,
        cycleDate,
        eveningDate,
        eveningRoutes,
        morningRoutes,
        hasEveningEntry: eveningRoutes.length > 0 && eveningRoutes.every((route) => route.hasEntry),
        hasMorningEntry: morningRoutes.length > 0 && morningRoutes.every((route) => route.hasEntry),
        hasStockEntry,
        products,
        cashSaleAmount: cashSaleAmount.toFixed(2),
        paymentsReceived: paymentsReceived.toFixed(2),
        balance: balance.toFixed(2),
      };
    });

    return {
      dbConnected: true,
      cycleDate,
      vehicles: vehicles.map((vehicle) => ({ id: vehicle.id, code: vehicle.code, name: vehicle.name })),
      reconciliationProducts: reconciliationProductRecords,
      cycles,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load reconciliation data.";

    return fallbackPayload(cycleDate, message);
  }
}

export type CashReportPayload = {
  dbConnected: boolean;
  vehicles: Array<{ id: string; code: string; name: string }>;
  products: Array<{ id: string; name: string; unit: string }>;
  selectedVehicleId: string;
  from: string;
  to: string;
  days: Array<{
    date: string;
    stockRecorded: boolean;
    deposited: string;
    pending: string;
    products: Array<{
      productId: string;
      given: string;
      delivered: string;
      returned: string;
      cashQty: string;
      cashAmount: string;
    }>;
  }>;
  // Every deposit in the range, including cancelled ones. Only VERIFIED rows
  // feed the totals; the rest are here so an operator can see what was entered
  // and correct it.
  deposits: Array<{
    id: string;
    cycleDate: string;
    paymentDate: string;
    amount: string;
    mode: string;
    status: string;
    referenceNo: string;
    notes: string;
  }>;
  totals: {
    products: Array<{
      productId: string;
      taken: string;
      distributed: string;
      returned: string;
      cashQty: string;
      cashAmount: string;
    }>;
    totalCash: string;
    totalDeposited: string;
    owed: string;
    daysRecorded: number;
    daysMissingStock: number;
  };
  error?: string;
};

// What a vehicle sold for cash over a date range, and what its driver still
// owes for it.
//
// A cycle is the PREVIOUS evening's round plus this morning's, which is how
// the per-cycle screen already pairs them — the milk loaded covers both.
export async function getVehicleCashReportPayload(input?: {
  vehicleId?: string;
  from?: string;
  to?: string;
}): Promise<CashReportPayload> {
  const today = new Date();
  const defaultFrom = toDateInput(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  const from = /^\d{4}-\d{2}-\d{2}$/.test(input?.from ?? "") ? (input!.from as string) : defaultFrom;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(input?.to ?? "") ? (input!.to as string) : toDateInput(today);

  const empty: CashReportPayload = {
    dbConnected: false,
    vehicles: [],
    products: [],
    selectedVehicleId: input?.vehicleId ?? "",
    from,
    to,
    days: [],
    deposits: [],
    totals: {
      products: [],
      totalCash: "0.00",
      totalDeposited: "0.00",
      owed: "0.00",
      daysRecorded: 0,
      daysMissingStock: 0,
    },
  };

  try {
    const cityId = await getCurrentCityId();

    const [vehicles, products] = await Promise.all([
      prisma.vehicle.findMany({
        where: { cityId, isActive: true },
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          routes: { where: { isActive: true }, select: { id: true, shift: true } },
        },
      }),
      prisma.product.findMany({
        where: { cityId, isActive: true, includeInReconciliation: true },
        orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
        select: { id: true, name: true, unit: true, defaultRate: true },
      }),
    ]);

    const selectedVehicleId =
      input?.vehicleId && vehicles.some((vehicle) => vehicle.id === input.vehicleId)
        ? input.vehicleId
        : vehicles[0]?.id ?? "";
    const vehicle = vehicles.find((entry) => entry.id === selectedVehicleId);
    const vehicleOptions = vehicles.map(({ id, code, name }) => ({ id, code, name }));
    const productOptions = products.map(({ id, name, unit }) => ({ id, name, unit }));

    if (!vehicle) {
      return { ...empty, dbConnected: true, vehicles: vehicleOptions, products: productOptions, selectedVehicleId };
    }

    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T00:00:00.000Z`);
    // The evening half of the first cycle falls on the day before the range.
    const deliveriesFrom = addDays(from, -1);

    const [stockRows, deposits, shiftDeliveryRows] = await Promise.all([
      prisma.vehicleCycleStock.findMany({
        where: { vehicleId: vehicle.id, cycleDate: { gte: fromDate, lte: toDate } },
        select: { productId: true, cycleDate: true, givenQty: true, returnedQty: true, rateSnapshot: true },
      }),
      prisma.vehicleCashSalePayment.findMany({
        where: { vehicleId: vehicle.id, cycleDate: { gte: fromDate, lte: toDate } },
        orderBy: [{ cycleDate: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          cycleDate: true,
          paymentDate: true,
          amount: true,
          mode: true,
          status: true,
          referenceNo: true,
          notes: true,
        },
      }),
      // By vehicle rather than by route, matching the daily screen: every
      // route this vehicle ran in a shift counts, including one it has since
      // handed back, and the vehicle comes from the entry's own snapshot
      // where it has one. Summed in SQL (one row per shift+date+product)
      // rather than pulling every non-skipped line/product row across the
      // whole range and summing in JS — this range can span a full month,
      // and only the per-product total is ever read below, never which
      // customer or line it came from.
      prisma.$queryRaw<Array<{ entryDate: Date; shift: string; productId: string; quantity: unknown }>>`
        SELECT e."entryDate" AS "entryDate", r."shift" AS "shift", dp."productId" AS "productId",
          SUM(dp.quantity)::numeric AS "quantity"
        FROM "DailyRouteEntryLineProduct" dp
        JOIN "DailyRouteEntryLine" dl ON dl.id = dp."lineId" AND dl.skipped = false
        JOIN "DailyRouteEntry" e ON e.id = dl."entryId"
        JOIN "Route" r ON r.id = e."routeId"
        WHERE e."entryDate" >= ${new Date(`${deliveriesFrom}T00:00:00.000Z`)} AND e."entryDate" <= ${toDate}
          AND (e."vehicleId" = ${vehicle.id}::uuid OR (e."vehicleId" IS NULL AND r."vehicleId" = ${vehicle.id}::uuid))
        GROUP BY e."entryDate", r."shift", dp."productId"
      `,
    ]);

    // shift+date -> productId -> quantity, summed across however many routes
    // the vehicle covered in that shift.
    const deliveredByShiftDate = new Map<string, Map<string, number>>();
    shiftDeliveryRows.forEach((row) => {
      const key = `${row.shift}:${toDateInput(row.entryDate)}`;
      const perProduct = deliveredByShiftDate.get(key) ?? new Map<string, number>();
      perProduct.set(row.productId, Number(row.quantity));
      deliveredByShiftDate.set(key, perProduct);
    });

    // Cancelled and pending deposits are listed but never counted — the money
    // has not been confirmed as handed over.
    const depositByDate = new Map<string, number>();
    deposits
      .filter((deposit) => deposit.status === "VERIFIED")
      .forEach((deposit) => {
        const key = toDateInput(deposit.cycleDate);
        depositByDate.set(key, (depositByDate.get(key) ?? 0) + Number(deposit.amount));
      });

    const days: CashReportDay[] = [];
    const perDayDetail: CashReportPayload["days"] = [];

    for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
      const eveningDate = addDays(cursor, -1);
      const dayStock = stockRows.filter((row) => toDateInput(row.cycleDate) === cursor);
      const stockRecorded = dayStock.length > 0;
      const deposited = depositByDate.get(cursor) ?? 0;

      const dayProducts = products.map((product) => {
        const stock = dayStock.find((row) => row.productId === product.id);
        const delivered =
          (deliveredByShiftDate.get(`MORNING:${cursor}`)?.get(product.id) ?? 0) +
          (deliveredByShiftDate.get(`EVENING:${eveningDate}`)?.get(product.id) ?? 0);

        return {
          productId: product.id,
          given: stock ? Number(stock.givenQty) : 0,
          delivered,
          returned: stock ? Number(stock.returnedQty) : 0,
          rate:
            stock?.rateSnapshot !== null && stock?.rateSnapshot !== undefined
              ? Number(stock.rateSnapshot)
              : Number(product.defaultRate),
        };
      });

      days.push({ date: cursor, stockRecorded, deposited, products: dayProducts });

      const dayCash = stockRecorded
        ? dayProducts.reduce((sum, entry) => {
            const leftover = entry.given - entry.delivered - entry.returned;
            return sum + leftover * entry.rate;
          }, 0)
        : 0;

      perDayDetail.push({
        date: cursor,
        stockRecorded,
        deposited: deposited.toFixed(2),
        pending: (dayCash - deposited).toFixed(2),
        products: dayProducts.map((entry) => {
          const leftover = entry.given - entry.delivered - entry.returned;
          return {
            productId: entry.productId,
            given: entry.given.toFixed(3),
            delivered: entry.delivered.toFixed(3),
            returned: entry.returned.toFixed(3),
            cashQty: leftover.toFixed(3),
            cashAmount: (leftover * entry.rate).toFixed(2),
          };
        }),
      });
    }

    const totals = summariseCashReport(days);

    return {
      dbConnected: true,
      vehicles: vehicleOptions,
      products: productOptions,
      selectedVehicleId,
      from,
      to,
      days: perDayDetail,
      deposits: deposits.map((deposit) => ({
        id: deposit.id,
        cycleDate: toDateInput(deposit.cycleDate),
        paymentDate: toDateInput(deposit.paymentDate),
        amount: Number(deposit.amount).toFixed(2),
        mode: deposit.mode,
        status: deposit.status,
        referenceNo: deposit.referenceNo ?? "",
        notes: deposit.notes ?? "",
      })),
      totals: {
        products: totals.products.map((entry) => ({
          productId: entry.productId,
          taken: entry.taken.toFixed(3),
          distributed: entry.distributed.toFixed(3),
          returned: entry.returned.toFixed(3),
          cashQty: entry.cashQty.toFixed(3),
          cashAmount: entry.cashAmount.toFixed(2),
        })),
        totalCash: totals.totalCash.toFixed(2),
        totalDeposited: totals.totalDeposited.toFixed(2),
        owed: totals.owed.toFixed(2),
        daysRecorded: totals.daysRecorded,
        daysMissingStock: totals.daysMissingStock,
      },
    };
  } catch (error) {
    return {
      ...empty,
      error: error instanceof Error ? error.message : "Unable to load the cash report.",
    };
  }
}
