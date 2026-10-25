import "server-only";
import { getCurrentCityId } from "@/lib/current-city";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";

function monthBounds(month: string) {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

export type CustomerMonthProduct = {
  id: string;
  name: string;
  shortName: string | null;
  unit: string;
};

export type CustomerMonthLine = {
  lineId: string;
  entryDate: string;
  routeId: string;
  routeCode: string;
  routeName: string;
  shift: string;
  // Whether THIS date's bill (this customer, this billing month) is already
  // Generated/Locked — shown per row so staff see what's editable before
  // they try to save, not after.
  billLocked: boolean;
  billStatus: string | null;
  quantities: Record<string, string>;
};

export type CustomerMonthPayment = {
  id: string;
  paymentDate: string;
  routeId: string | null;
  amount: string;
  mode: string;
  status: string;
  referenceNo: string;
  notes: string;
};

export type CustomerMonthEntriesPayload = {
  dbConnected: boolean;
  customer: { id: string; code: string; name: string } | null;
  month: string;
  products: CustomerMonthProduct[];
  lines: CustomerMonthLine[];
  // This customer's most recently delivered non-zero quantity per product —
  // same source CustomerProductRecentOrder data Daily Entry's own "Fill
  // usual" reads (see src/lib/daily-entry-guard.ts's updateRecentOrderCache,
  // which is what keeps it current). Only ever applied to an empty cell on
  // an unlocked row, client-side, on explicit request.
  usualQuantities: Record<string, string>;
  // Every payment this customer made with a paymentDate inside this month —
  // shown alongside the deliveries so a disputed delivery and what they paid
  // for it are reviewed together, not on two separate screens.
  payments: CustomerMonthPayment[];
  // Set when nothing was found for this month AND this city has at least one
  // archived (rows actually deleted) route+month matching it — the honest
  // middle ground between "no deliveries" and knowing for certain which
  // route this customer's data was archived under, since route assignment
  // history for a deleted month is gone along with the deliveries.
  possiblyArchived: boolean;
  error?: string;
};

function fallbackPayload(month: string, error?: string): CustomerMonthEntriesPayload {
  return {
    dbConnected: false,
    customer: null,
    month,
    products: [],
    lines: [],
    usualQuantities: {},
    payments: [],
    possiblyArchived: false,
    error,
  };
}

export async function getCustomerMonthEntries(customerId: string, month: string): Promise<CustomerMonthEntriesPayload> {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return fallbackPayload(month, "Invalid month.");
  }

  try {
    const cityId = await getCurrentCityId();

    const customer = await withDbTimeout(
      prisma.customer.findFirst({
        where: { id: customerId, cityId },
        select: { id: true, code: true, name: true },
      }),
      "Customer month entries: customer request",
    );

    if (!customer) {
      return fallbackPayload(month, "Customer not found in this city.");
    }

    const { start, end } = monthBounds(month);
    const billingMonth = start;

    const [lines, dailyEntryProducts, frozenBill, recentOrders, payments] = await withDbTimeout(
      Promise.all([
        prisma.dailyRouteEntryLine.findMany({
          where: { customerId, entry: { entryDate: { gte: start, lt: end }, route: { cityId } } },
          select: {
            id: true,
            entry: {
              select: {
                entryDate: true,
                routeId: true,
                route: { select: { code: true, name: true, shift: true } },
              },
            },
            productEntries: {
              select: { productId: true, quantity: true, product: { select: { showInDailyEntry: true } } },
            },
          },
          orderBy: { entry: { entryDate: "asc" } },
        }),
        prisma.product.findMany({
          where: { cityId, isActive: true, showInDailyEntry: true },
          orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
          select: { id: true, name: true, shortName: true, unit: true },
        }),
        prisma.monthlyBill.findFirst({
          where: { customerId, billingMonth, route: { cityId } },
          select: { status: true },
        }),
        prisma.customerProductRecentOrder.findMany({
          where: { customerId },
          select: { productId: true, entries: true },
        }),
        prisma.payment.findMany({
          where: { customerId, paymentDate: { gte: start, lt: end }, customer: { cityId } },
          orderBy: { paymentDate: "asc" },
          select: {
            id: true,
            paymentDate: true,
            routeId: true,
            amount: true,
            mode: true,
            status: true,
            referenceNo: true,
            notes: true,
          },
        }),
      ]),
      "Customer month entries: lines/products request",
    );

    // Daily Entry's regular columns, plus any occasional item (Ghee, a
    // one-off Paneer sale, …) that was actually recorded on one of this
    // customer's lines this month — those don't show in showInDailyEntry,
    // but a recorded quantity for one must still be visible somewhere, or
    // it silently vanishes from this screen despite being on the real bill.
    const productsById = new Map(dailyEntryProducts.map((product) => [product.id, product]));
    const occasionalProductIds = new Set<string>();
    for (const line of lines) {
      for (const productEntry of line.productEntries) {
        if (!productEntry.product.showInDailyEntry && !productsById.has(productEntry.productId)) {
          occasionalProductIds.add(productEntry.productId);
        }
      }
    }
    const occasionalProducts =
      occasionalProductIds.size > 0
        ? await prisma.product.findMany({
            where: { id: { in: [...occasionalProductIds] } },
            orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
            select: { id: true, name: true, shortName: true, unit: true },
          })
        : [];
    const products = [...dailyEntryProducts, ...occasionalProducts];

    const billLocked = frozenBill ? frozenBill.status === "GENERATED" || frozenBill.status === "LOCKED" : false;

    const usualQuantities: Record<string, string> = {};
    for (const order of recentOrders) {
      const entries = order.entries as unknown as Array<{ date: string; quantity: number }>;
      const mostRecent = entries[0];
      if (mostRecent && mostRecent.quantity > 0) {
        usualQuantities[order.productId] = String(mostRecent.quantity);
      }
    }

    let possiblyArchived = false;
    if (lines.length === 0) {
      const deletedArchive = await prisma.dailyEntryArchive.findFirst({
        where: { cityId, billingMonth, status: "DELETED" },
        select: { id: true },
      });
      possiblyArchived = deletedArchive !== null;
    }

    return {
      dbConnected: true,
      customer,
      month,
      products,
      lines: lines.map((line) => ({
        lineId: line.id,
        entryDate: line.entry.entryDate.toISOString().slice(0, 10),
        routeId: line.entry.routeId,
        routeCode: line.entry.route.code,
        routeName: line.entry.route.name,
        shift: line.entry.route.shift,
        billLocked,
        billStatus: frozenBill?.status ?? null,
        quantities: Object.fromEntries(
          line.productEntries.map((productEntry) => [productEntry.productId, productEntry.quantity.toFixed(3)]),
        ),
      })),
      usualQuantities,
      payments: payments.map((payment) => ({
        id: payment.id,
        paymentDate: payment.paymentDate.toISOString().slice(0, 10),
        routeId: payment.routeId,
        amount: payment.amount.toFixed(2),
        mode: payment.mode,
        status: payment.status,
        referenceNo: payment.referenceNo ?? "",
        notes: payment.notes ?? "",
      })),
      possiblyArchived,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load this customer's month.";
    return fallbackPayload(month, message);
  }
}
