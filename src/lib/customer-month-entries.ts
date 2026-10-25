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

export type CustomerMonthEntriesPayload = {
  dbConnected: boolean;
  customer: { id: string; code: string; name: string } | null;
  month: string;
  products: CustomerMonthProduct[];
  lines: CustomerMonthLine[];
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

    const [lines, products, frozenBill] = await withDbTimeout(
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
            productEntries: { select: { productId: true, quantity: true } },
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
      ]),
      "Customer month entries: lines/products request",
    );

    const billLocked = frozenBill ? frozenBill.status === "GENERATED" || frozenBill.status === "LOCKED" : false;

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
      possiblyArchived,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load this customer's month.";
    return fallbackPayload(month, message);
  }
}
