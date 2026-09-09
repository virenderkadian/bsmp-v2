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

type EntryWithProducts = {
  routeId: string;
  lines: Array<{
    productEntries: Array<{ productId: string; quantity: unknown }>;
  }>;
};

// Flattens a shift's route entries into routeId+productId -> total quantity,
// so the per-vehicle reconciliation loop below is a map lookup instead of a
// nested scan through every line/product-entry per vehicle.
function buildRouteProductQtyMap(entries: EntryWithProducts[]) {
  const map = new Map<string, number>();

  for (const entry of entries) {
    for (const line of entry.lines) {
      for (const productEntry of line.productEntries) {
        const key = `${entry.routeId}:${productEntry.productId}`;
        map.set(key, (map.get(key) ?? 0) + Number(productEntry.quantity));
      }
    }
  }

  return map;
}

export type ReconciliationProductLine = {
  productId: string;
  productName: string;
  unit: string;
  given: string;
  eveningDelivered: string;
  morningDelivered: string;
  returned: string;
  leftover: string;
  rate: string;
  leftoverValue: string;
};

export type ReconciliationCycle = {
  vehicleId: string;
  vehicleCode: string;
  vehicleName: string;
  cycleDate: string;
  eveningDate: string;
  eveningRouteId: string | null;
  eveningRouteName: string | null;
  morningRouteId: string | null;
  morningRouteName: string | null;
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
          select: { id: true, name: true, unit: true, defaultRate: true },
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
    const eveningRouteIds = vehicles
      .map((vehicle) => vehicle.routes.find((route) => route.shift === "EVENING")?.id)
      .filter((id): id is string => Boolean(id));
    const morningRouteIds = vehicles
      .map((vehicle) => vehicle.routes.find((route) => route.shift === "MORNING")?.id)
      .filter((id): id is string => Boolean(id));

    const [eveningEntries, morningEntries, stockRows, paymentRows] = await Promise.all([
      withDbTimeout(
        prisma.dailyRouteEntry.findMany({
          where: { routeId: { in: eveningRouteIds }, entryDate: new Date(eveningDate) },
          select: {
            routeId: true,
            lines: {
              select: {
                productEntries: {
                  where: { productId: { in: productIds } },
                  select: { productId: true, quantity: true },
                },
              },
            },
          },
        }),
        "Reconciliation evening entries request",
      ),
      withDbTimeout(
        prisma.dailyRouteEntry.findMany({
          where: { routeId: { in: morningRouteIds }, entryDate: new Date(cycleDate) },
          select: {
            routeId: true,
            lines: {
              select: {
                productEntries: {
                  where: { productId: { in: productIds } },
                  select: { productId: true, quantity: true },
                },
              },
            },
          },
        }),
        "Reconciliation morning entries request",
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

    const eveningQtyMap = buildRouteProductQtyMap(eveningEntries);
    const morningQtyMap = buildRouteProductQtyMap(morningEntries);
    const eveningEntryRouteIds = new Set(eveningEntries.map((entry) => entry.routeId));
    const morningEntryRouteIds = new Set(morningEntries.map((entry) => entry.routeId));

    const paymentsByVehicle = new Map<string, number>();
    paymentRows.forEach((payment) => {
      paymentsByVehicle.set(payment.vehicleId, (paymentsByVehicle.get(payment.vehicleId) ?? 0) + Number(payment.amount));
    });

    const cycles: ReconciliationCycle[] = vehicles.map((vehicle) => {
      const eveningRoute = vehicle.routes.find((route) => route.shift === "EVENING") ?? null;
      const morningRoute = vehicle.routes.find((route) => route.shift === "MORNING") ?? null;

      let hasStockEntry = false;
      let cashSaleAmount = 0;

      const products: ReconciliationProductLine[] = reconciliationProducts.map((product) => {
        const eveningDelivered = eveningRoute
          ? (eveningQtyMap.get(`${eveningRoute.id}:${product.id}`) ?? 0)
          : 0;
        const morningDelivered = morningRoute
          ? (morningQtyMap.get(`${morningRoute.id}:${product.id}`) ?? 0)
          : 0;
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
          unit: product.unit,
          given: given.toFixed(3),
          eveningDelivered: eveningDelivered.toFixed(3),
          morningDelivered: morningDelivered.toFixed(3),
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
        eveningRouteId: eveningRoute?.id ?? null,
        eveningRouteName: eveningRoute?.name ?? null,
        morningRouteId: morningRoute?.id ?? null,
        morningRouteName: morningRoute?.name ?? null,
        hasEveningEntry: eveningRoute ? eveningEntryRouteIds.has(eveningRoute.id) : false,
        hasMorningEntry: morningRoute ? morningEntryRouteIds.has(morningRoute.id) : false,
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

    const morningRouteId = vehicle.routes.find((route) => route.shift === "MORNING")?.id;
    const eveningRouteId = vehicle.routes.find((route) => route.shift === "EVENING")?.id;
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T00:00:00.000Z`);
    // The evening half of the first cycle falls on the day before the range.
    const deliveriesFrom = addDays(from, -1);

    const [stockRows, deposits, entries] = await Promise.all([
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
      prisma.dailyRouteEntry.findMany({
        where: {
          routeId: { in: [morningRouteId, eveningRouteId].filter((id): id is string => Boolean(id)) },
          entryDate: { gte: new Date(`${deliveriesFrom}T00:00:00.000Z`), lte: toDate },
        },
        select: {
          routeId: true,
          entryDate: true,
          lines: {
            where: { skipped: false },
            select: { productEntries: { select: { productId: true, quantity: true } } },
          },
        },
      }),
    ]);

    const deliveredByRouteDate = new Map<string, Map<string, number>>();
    entries.forEach((entry) => {
      const key = `${entry.routeId}:${toDateInput(entry.entryDate)}`;
      const perProduct = deliveredByRouteDate.get(key) ?? new Map<string, number>();
      entry.lines.forEach((line) => {
        line.productEntries.forEach((productEntry) => {
          perProduct.set(
            productEntry.productId,
            (perProduct.get(productEntry.productId) ?? 0) + Number(productEntry.quantity),
          );
        });
      });
      deliveredByRouteDate.set(key, perProduct);
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
          (morningRouteId
            ? (deliveredByRouteDate.get(`${morningRouteId}:${cursor}`)?.get(product.id) ?? 0)
            : 0) +
          (eveningRouteId
            ? (deliveredByRouteDate.get(`${eveningRouteId}:${eveningDate}`)?.get(product.id) ?? 0)
            : 0);

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
