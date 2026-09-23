import { Prisma } from "@prisma/client";
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

    // "ALL" is a deliberate choice (see the route <select> in page.tsx) —
    // distinct from "", which means nothing has been picked yet. Unlike
    // Route Sequence, this report has a real use for scanning every route at
    // once (catching typos before bills go out), so it stays available —
    // it just isn't what loads before anyone's chosen anything.
    const routeChoice = input?.routeId ?? "";
    const selectedRouteId =
      routeChoice === "ALL" || activeRoutes.some((route) => route.id === routeChoice) ? routeChoice : "";

    if (!selectedRouteId) {
      return { dbConnected: true, routes: activeRoutes, selectedRouteId: "", selectedMonth, rows: [] };
    }

    const routeIds = selectedRouteId === "ALL" ? activeRoutes.map((route) => route.id) : [selectedRouteId];
    const routeById = new Map(activeRoutes.map((route) => [route.id, route]));

    const { start: monthStart, end: monthEnd } = getMonthBounds(new Date(`${selectedMonth}-01T00:00:00.000Z`));
    // Same lookback window the live per-day hint uses, so a delivery on the
    // 1st of the month gets exactly the history it would have had live, not
    // an artificially thin one. 20 days rather than the original 45: real
    // production data shows 96% of customer+product pairs that ever reach
    // the 10-delivery HISTORY_LIMIT do so within 20 days — daily items reach
    // it in under 2 weeks, and the extra 25 days were mostly paying for a
    // small tail of occasional items whose history is inherently thin no
    // matter the window.
    const lookbackStart = new Date(monthStart);
    lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 20);

    // Raw SQL, not a nested Prisma include: the same query shaped as
    // route -> lines -> productEntries (each with its own relation filter)
    // generates enough bind variables at this city's real data volume to
    // exceed Postgres's 32,767-parameter limit for "all routes" — this
    // failed outright in testing, not just slow. A flat query with a
    // handful of parameters regardless of row count doesn't have that
    // ceiling, and applies the showInDailyEntry/quantity>0 filters at the
    // DB instead of fetching then discarding them in JS.
    const deliveryRows = await withDbTimeout(
      prisma.$queryRaw<
        Array<{
          entryDate: Date;
          routeId: string;
          customerId: string;
          customerName: string;
          customerCode: string;
          productId: string;
          productLabel: string;
          quantity: Prisma.Decimal;
        }>
      >`
        SELECT
          e."entryDate" AS "entryDate",
          e."routeId" AS "routeId",
          dl."customerId" AS "customerId",
          c.name AS "customerName",
          c.code AS "customerCode",
          dp."productId" AS "productId",
          COALESCE(p."shortName", p.name) AS "productLabel",
          dp.quantity AS "quantity"
        FROM "DailyRouteEntry" e
        JOIN "DailyRouteEntryLine" dl ON dl."entryId" = e.id AND dl.skipped = false
        JOIN "Customer" c ON c.id = dl."customerId"
        JOIN "DailyRouteEntryLineProduct" dp ON dp."lineId" = dl.id
        JOIN "Product" p ON p.id = dp."productId"
        WHERE e."routeId"::text IN (${Prisma.join(routeIds)})
          AND e."entryDate" >= ${lookbackStart} AND e."entryDate" < ${monthEnd}
          AND dp.quantity > 0
          AND p."showInDailyEntry" = true
        ORDER BY e."entryDate" ASC
      `,
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

    for (const row of deliveryRows) {
      const key = `${row.customerId}:${row.productId}`;
      const series = seriesByCustomerProduct.get(key) ?? [];
      series.push({
        date: row.entryDate.toISOString().slice(0, 10),
        routeId: row.routeId,
        customerId: row.customerId,
        customerName: row.customerName,
        customerCode: row.customerCode,
        productId: row.productId,
        productLabel: row.productLabel,
        quantity: Number(row.quantity),
      });
      seriesByCustomerProduct.set(key, series);
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
