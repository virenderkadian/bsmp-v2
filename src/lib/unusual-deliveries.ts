import { getCurrentCityId } from "@/lib/current-city";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";
import { computeModeQuantity, computeQuantityBand, isQuantityUnusual } from "@/lib/quantity-baseline";

export type UnusualDeliveryRow = {
  date: string;
  routeCode: string;
  routeName: string;
  customerName: string;
  customerCode: string;
  productLabel: string;
  quantity: string;
  // Same wording as the live Daily Entry tooltip, minus the "Unusual — "
  // prefix, which the report's own heading already carries.
  detail: string;
};

export type UnusualDeliveriesPayload = {
  dbConnected: boolean;
  routes: Array<{ id: string; code: string; name: string }>;
  selectedRouteId: string;
  selectedMonth: string;
  rows: UnusualDeliveryRow[];
  error?: string;
};

function getMonthBounds(monthValue: Date) {
  const start = new Date(Date.UTC(monthValue.getUTCFullYear(), monthValue.getUTCMonth(), 1));
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

function getMonthInputValue(monthValue?: string) {
  if (monthValue && /^\d{4}-\d{2}$/.test(monthValue)) {
    return monthValue;
  }

  // Defaults to the CURRENT month, unlike the billing summary's "previous
  // month" default — this report is a working tool for reviewing entries as
  // they're made (e.g. before generating this month's bills), not a
  // collections tool for a month that's already closed.
  return new Date().toISOString().slice(0, 7);
}

function fallbackPayload(month?: string, error?: string): UnusualDeliveriesPayload {
  return {
    dbConnected: false,
    routes: [],
    selectedRouteId: "",
    selectedMonth: getMonthInputValue(month),
    rows: [],
    error,
  };
}

// This customer's own last several non-zero deliveries of this product, up
// to and NOT including the one at `uptoIndex` — used to judge that specific
// delivery exactly as it would have looked live, on the day it happened, not
// with the benefit of hindsight from later in the month.
const HISTORY_LIMIT = 10;

function historyBefore(deliveries: number[], uptoIndex: number): number[] {
  const start = Math.max(0, uptoIndex - HISTORY_LIMIT);
  return deliveries.slice(start, uptoIndex);
}

export async function getUnusualDeliveriesReport(input?: {
  month?: string;
  routeId?: string;
}): Promise<UnusualDeliveriesPayload> {
  const selectedMonth = getMonthInputValue(input?.month);

  try {
    const cityId = await getCurrentCityId();
    const activeRoutes = await withDbTimeout(
      prisma.route.findMany({
        where: { cityId, isActive: true },
        orderBy: [{ shift: "asc" }, { code: "asc" }],
        select: { id: true, code: true, name: true },
      }),
      "Unusual deliveries route request",
    );

    if (activeRoutes.length === 0) {
      return { dbConnected: true, routes: [], selectedRouteId: "", selectedMonth, rows: [] };
    }

    const selectedRouteId =
      input?.routeId && activeRoutes.some((route) => route.id === input.routeId) ? input.routeId : "";
    const routeIds = selectedRouteId ? [selectedRouteId] : activeRoutes.map((route) => route.id);
    const routeById = new Map(activeRoutes.map((route) => [route.id, route]));

    const { start: monthStart, end: monthEnd } = getMonthBounds(new Date(`${selectedMonth}-01T00:00:00.000Z`));
    // Same lookback window the live per-day hint uses, so a delivery on the
    // 1st of the month gets exactly the history it would have had live, not
    // an artificially thin one.
    const lookbackStart = new Date(monthStart);
    lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 45);

    const entries = await withDbTimeout(
      prisma.dailyRouteEntry.findMany({
        where: {
          routeId: { in: routeIds },
          entryDate: { gte: lookbackStart, lt: monthEnd },
        },
        orderBy: { entryDate: "asc" },
        select: {
          entryDate: true,
          routeId: true,
          lines: {
            where: { skipped: false },
            select: {
              customerId: true,
              customer: { select: { name: true, code: true } },
              productEntries: {
                select: {
                  productId: true,
                  quantity: true,
                  product: { select: { name: true, shortName: true, showInDailyEntry: true } },
                },
              },
            },
          },
        },
      }),
      "Unusual deliveries entry request",
    );

    // One chronological (date, quantity) series per customer+product, plus
    // enough to label a flagged row without a second query.
    type Delivery = {
      date: string;
      routeId: string;
      customerId: string;
      customerName: string;
      customerCode: string;
      productId: string;
      productLabel: string;
      quantity: number;
    };

    const seriesByCustomerProduct = new Map<string, Delivery[]>();

    for (const entry of entries) {
      const date = entry.entryDate.toISOString().slice(0, 10);
      for (const line of entry.lines) {
        for (const productEntry of line.productEntries) {
          // Occasional items are excluded on purpose — see Step 4's decision
          // in the daily-entry quantity-check work: too sparse in real usage
          // for a history-based band to mean anything, and low volume enough
          // that it wasn't worth a separate check.
          if (!productEntry.product.showInDailyEntry) {
            continue;
          }

          const quantity = Number(productEntry.quantity);
          if (quantity <= 0) {
            continue;
          }

          const key = `${line.customerId}:${productEntry.productId}`;
          const series = seriesByCustomerProduct.get(key) ?? [];
          series.push({
            date,
            routeId: entry.routeId,
            customerId: line.customerId,
            customerName: line.customer.name,
            customerCode: line.customer.code,
            productId: productEntry.productId,
            productLabel: productEntry.product.shortName ?? productEntry.product.name,
            quantity,
          });
          seriesByCustomerProduct.set(key, series);
        }
      }
    }

    const monthStartStr = monthStart.toISOString().slice(0, 10);
    const rows: UnusualDeliveryRow[] = [];

    for (const series of seriesByCustomerProduct.values()) {
      const quantities = series.map((delivery) => delivery.quantity);

      series.forEach((delivery, index) => {
        // Only deliveries actually IN the selected month are reportable —
        // everything before that is lookback, used only to build history.
        if (delivery.date < monthStartStr) {
          return;
        }

        const history = historyBefore(quantities, index);
        const band = computeQuantityBand(history);

        if (!isQuantityUnusual(delivery.quantity, band, history)) {
          return;
        }

        const modeQuantity = computeModeQuantity(history);
        const usualQuantity = modeQuantity ?? band?.median ?? null;
        const route = routeById.get(delivery.routeId);

        rows.push({
          date: delivery.date,
          routeCode: route?.code ?? "",
          routeName: route?.name ?? "",
          customerName: delivery.customerName,
          customerCode: delivery.customerCode,
          productLabel: delivery.productLabel,
          quantity: String(delivery.quantity),
          detail: usualQuantity !== null ? `usually takes ${usualQuantity}` : "different from their recent orders",
        });
      });
    }

    rows.sort((a, b) => a.date.localeCompare(b.date) || a.customerName.localeCompare(b.customerName));

    return {
      dbConnected: true,
      routes: activeRoutes,
      selectedRouteId,
      selectedMonth,
      rows,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load the unusual deliveries report.";
    return fallbackPayload(input?.month, message);
  }
}
