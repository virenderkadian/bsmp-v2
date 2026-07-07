import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";

export type ReconciliationRecord = {
  key: string;
  routeId: string;
  routeCode: string;
  routeName: string;
  vehicleName: string | null;
  entryDate: Date;
  totalQuantity: string;
  deliveryAmount: string;
  verifiedCollection: string;
  customerStops: number;
  status: "OPEN" | "MATCHED";
};

export type ReconciliationPayload = {
  dbConnected: boolean;
  routes: Array<{ id: string; code: string; name: string }>;
  vehicles: Array<{ id: string; code: string; name: string }>;
  rows: ReconciliationRecord[];
  error?: string;
};

function fallbackPayload(error?: string): ReconciliationPayload {
  return {
    dbConnected: false,
    routes: [],
    vehicles: [],
    rows: [],
    error,
  };
}

export async function getReconciliationPayload(): Promise<ReconciliationPayload> {
  try {
    const routes = await withDbTimeout(prisma.route.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
      },
    }), "Reconciliation route request");

    const vehicles = await withDbTimeout(prisma.vehicle.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
      },
    }), "Reconciliation vehicle request");

    const entries = await withDbTimeout(prisma.dailyRouteEntry.findMany({
      orderBy: [{ entryDate: "desc" }, { route: { code: "asc" } }],
      select: {
        routeId: true,
        entryDate: true,
        route: {
          select: {
            code: true,
            name: true,
            vehicle: {
              select: {
                name: true,
              },
            },
          },
        },
        lines: {
          select: {
            customerId: true,
            productEntries: {
              select: {
                quantity: true,
                rateSnapshot: true,
              },
            },
          },
        },
      },
    }), "Reconciliation entry request");

    const verifiedPayments = await withDbTimeout(prisma.payment.findMany({
      where: {
        status: "VERIFIED",
        routeId: { not: null },
      },
      select: {
        routeId: true,
        amount: true,
        paymentDate: true,
      },
    }), "Reconciliation payment request");

    const paymentMap = new Map<string, number>();

    verifiedPayments.forEach((payment) => {
      if (!payment.routeId) {
        return;
      }

      const day = payment.paymentDate.toISOString().slice(0, 10);
      const key = `${payment.routeId}:${day}`;
      paymentMap.set(key, (paymentMap.get(key) ?? 0) + Number(payment.amount));
    });

    const rows = entries.map((entry) => {
      const totalQuantity = entry.lines.reduce(
        (sum, line) =>
          sum +
          line.productEntries.reduce(
            (lineSum, productEntry) => lineSum + Number(productEntry.quantity),
            0,
          ),
        0,
      );

      const deliveryAmount = entry.lines.reduce(
        (sum, line) =>
          sum +
          line.productEntries.reduce(
            (lineSum, productEntry) =>
              lineSum + Number(productEntry.quantity) * Number(productEntry.rateSnapshot),
            0,
          ),
        0,
      );

      const day = entry.entryDate.toISOString().slice(0, 10);
      const paymentKey = `${entry.routeId}:${day}`;
      const verifiedCollection = paymentMap.get(paymentKey) ?? 0;

      return {
        key: `${entry.routeId}:${day}`,
        routeId: entry.routeId,
        routeCode: entry.route.code,
        routeName: entry.route.name,
        vehicleName: entry.route.vehicle?.name ?? null,
        entryDate: entry.entryDate,
        totalQuantity: totalQuantity.toFixed(3),
        deliveryAmount: deliveryAmount.toFixed(2),
        verifiedCollection: verifiedCollection.toFixed(2),
        customerStops: entry.lines.length,
        status: deliveryAmount <= verifiedCollection ? "MATCHED" : "OPEN",
      } as ReconciliationRecord;
    });

    return {
      dbConnected: true,
      routes,
      vehicles,
      rows,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load reconciliation data.";

    return fallbackPayload(message);
  }
}
