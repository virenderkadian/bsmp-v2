import { getCurrentCityId } from "@/lib/current-city";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";
import { computeLeftover, computeLeftoverValue, computeVehicleBalance } from "@/lib/reconciliation-math";

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
          select: { vehicleId: true, productId: true, givenQty: true, returnedQty: true },
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
        const rate = Number(product.defaultRate);
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
