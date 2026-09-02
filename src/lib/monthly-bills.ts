import type { BillingStatus, MonthlyBill, PaymentMode } from "@prisma/client";
import { getCurrentCityId } from "@/lib/current-city";
import { getCityCustomerLedger, receivedAgainstOpenBill } from "@/lib/bill-ledger";
import { mergeCalendarDays, resolveBillingRoutes, selectBillingRows } from "@/lib/monthly-bills-math";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";

export type MonthlyBillItemRecord = {
  id: string;
  productCode: string;
  productName: string;
  productShortName: string | null;
  unit: string;
  totalQty: string;
  averageRate: string;
  totalAmount: string;
};

export type MonthlyBillRecord = Pick<
  MonthlyBill,
  "id" | "customerId" | "routeId" | "billingMonth" | "status" | "generatedAt"
> & {
  customerCode: string;
  customerName: string;
  routeCode: string;
  routeName: string;
  openingBalance: string;
  deliveryAmount: string;
  paymentAmount: string;
  closingBalance: string;
  itemSummary: string;
  items: MonthlyBillItemRecord[];
};

export type MonthlyBillPayload = {
  dbConnected: boolean;
  customers: Array<{ id: string; code: string; name: string }>;
  routes: Array<{ id: string; code: string; name: string }>;
  bills: MonthlyBillRecord[];
  // The month whose bills are loaded, and every month that has any. Bills are
  // fetched one month at a time, so the picker can no longer derive its
  // options from the rows on screen.
  selectedMonth: string;
  availableMonths: string[];
  statuses: Array<{ value: BillingStatus; label: string }>;
  error?: string;
};

export type MonthlyBillDeliveryProduct = {
  productCode: string;
  productName: string;
  productShortName: string | null;
  unit: string;
  quantity: string;
  rateSnapshot: string;
  totalAmount: string;
};

export type MonthlyBillDeliveryRow = {
  id: string;
  entryDate: Date;
  skipped: boolean;
  remarks: string | null;
  products: MonthlyBillDeliveryProduct[];
  totalAmount: string;
};

export type MonthlyBillPaymentRecord = {
  id: string;
  amount: string;
  paymentDate: Date;
  mode: PaymentMode;
  referenceNo: string | null;
  notes: string | null;
};

export type MonthlyBillDocumentProduct = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  unit: string;
};

export type MonthlyBillCalendarProductCell = {
  quantity: string;
  rate: string;
  amount: string;
};

export type MonthlyBillCalendarDay = {
  day: number;
  date: Date;
  hasEntry: boolean;
  skipped: boolean;
  products: Record<string, MonthlyBillCalendarProductCell>;
  grossAmount: string;
};

export type MonthlyBillCalendarTotals = {
  products: Record<string, { quantity: string; amount: string }>;
  grossAmount: string;
};

export type MonthlyBillBusinessProfile = {
  businessName: string;
  contactPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  bankName: string | null;
  upiId: string | null;
  upiQrDataUrl: string | null;
  footerNote: string | null;
};

export type MonthlyBillDetail = MonthlyBillRecord & {
  customerMobile: string | null;
  customerArea: string | null;
  customerAddressLine1: string | null;
  customerAddressLine2: string | null;
  customerSequenceNo: number | null;
  routeShift: string;
  driverName: string | null;
  driverPhone: string | null;
  calendarProducts: MonthlyBillDocumentProduct[];
  calendarDays: MonthlyBillCalendarDay[];
  calendarTotals: MonthlyBillCalendarTotals;
  businessProfile: MonthlyBillBusinessProfile | null;
  deliveryRows: MonthlyBillDeliveryRow[];
  payments: MonthlyBillPaymentRecord[];
};

export type MonthlyBillDetailPayload = {
  dbConnected: boolean;
  bill?: MonthlyBillDetail;
  error?: string;
};

export type MonthlyBillSummaryProduct = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  unit: string;
};

export type MonthlyBillSummaryCustomerRow = {
  key: string;
  sequenceNo: number;
  customerId: string;
  customerCode: string;
  customerName: string;
  customerArea: string | null;
  customerMobile: string | null;
  productQuantities: Record<string, string>;
  deliveryAmount: string;
  openingBalance: string;
  paymentAmount: string;
  pendingAmount: string;
  source: "BILL" | "DAILY_ENTRY";
  billId: string | null;
  status: BillingStatus | null;
  // False when the customer has deliveries this month but no sequence row —
  // removed mid-month. Still billed for what they received; shown so they
  // can't be billed invisibly.
  inSequence: boolean;
};

export type MonthlyBillSummaryTotals = {
  productQuantities: Record<string, string>;
  deliveryAmount: string;
  openingBalance: string;
  paymentAmount: string;
  pendingAmount: string;
};

export type MonthlyBillSummaryRoute = {
  id: string;
  code: string;
  name: string;
  shift: string;
  rows: MonthlyBillSummaryCustomerRow[];
  totals: MonthlyBillSummaryTotals;
};

// A customer carrying a balance who has NO bill this month — they're not on
// any route and had no deliveries, so nothing in the normal flow would show
// them. Without this they quietly drop off the radar while still owing money.
export type MonthlyBillOutstandingRow = {
  customerId: string;
  customerCode: string;
  customerName: string;
  customerMobile: string | null;
  lastBilledMonth: string;
  outstandingAmount: string;
};

export type MonthlyBillSummaryPayload = {
  dbConnected: boolean;
  selectedMonth: string;
  selectedRouteId: string;
  selectedRouteLabel: string;
  products: MonthlyBillSummaryProduct[];
  routes: MonthlyBillSummaryRoute[];
  grandTotals: MonthlyBillSummaryTotals;
  outstanding: MonthlyBillOutstandingRow[];
  // When the displayed figures were computed, if any row is reading a stored
  // bill rather than live daily-entry data. A generated bill freezes its
  // amounts, so deliveries recorded afterwards don't appear until the month is
  // regenerated — without this the screen presents a snapshot exactly like
  // live data and there's no way to tell. Null when nothing is stale.
  figuresAsOf: string | null;
  error?: string;
};

const statuses: MonthlyBillPayload["statuses"] = [
  { value: "DRAFT", label: "Draft" },
  { value: "GENERATED", label: "Generated" },
  { value: "LOCKED", label: "Locked" },
  { value: "CANCELLED", label: "Cancelled" },
];

function fallbackPayload(error?: string, month?: string): MonthlyBillPayload {
  const fallbackMonth = month ?? new Date().toISOString().slice(0, 7);
  return {
    dbConnected: false,
    customers: [],
    routes: [],
    bills: [],
    selectedMonth: fallbackMonth,
    availableMonths: [fallbackMonth],
    statuses,
    error,
  };
}

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

  // Default to the PREVIOUS month, not the current one: a month's bills are
  // only generated and chased once the month is complete, so when someone
  // opens this page mid-July the statements they're actually collecting on
  // are June's.
  const now = new Date();
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return previous.toISOString().slice(0, 7);
}

function monthInputToDate(monthValue?: string) {
  return new Date(`${getMonthInputValue(monthValue)}-01T00:00:00.000Z`);
}

function toMoney(value: unknown) {
  return Number(value).toFixed(2);
}

function toQuantity(value: unknown) {
  return Number(value).toFixed(3);
}

type CalendarSourceLine = {
  skipped: boolean;
  productEntries: Array<{
    quantity: unknown;
    rateSnapshot: unknown;
    product: { id: string };
  }>;
};

// Collapses a customer's daily lines into one per calendar date, merging any
// date that has lines from several routes (morning + evening). A date with a
// single line passes through completely untouched, so the overwhelmingly
// common single-route case keeps its exact previous shape and behaviour.
function buildMergedDayEntryMap(
  rows: Array<{ day: number; line: CalendarSourceLine | undefined }>,
): Map<number, CalendarSourceLine | undefined> {
  const linesByDay = new Map<number, CalendarSourceLine[]>();
  for (const row of rows) {
    if (!row.line) {
      continue;
    }
    const existing = linesByDay.get(row.day) ?? [];
    existing.push(row.line);
    linesByDay.set(row.day, existing);
  }

  const merged = new Map<number, CalendarSourceLine | undefined>();
  for (const [day, lines] of linesByDay) {
    if (lines.length === 1) {
      merged.set(day, lines[0]);
      continue;
    }

    const combined = mergeCalendarDays(
      lines.map((line) => ({
        skipped: line.skipped,
        entries: line.productEntries.map((entry) => ({
          productId: entry.product.id,
          quantity: Number(entry.quantity),
          rateSnapshot: Number(entry.rateSnapshot),
        })),
      })),
    );

    merged.set(day, {
      skipped: combined.skipped,
      productEntries: combined.entries.map((entry) => ({
        quantity: entry.quantity,
        rateSnapshot: entry.rateSnapshot,
        product: { id: entry.productId },
      })),
    });
  }

  return merged;
}

function buildCalendarDays(
  dayEntryMap: Map<number, CalendarSourceLine | undefined>,
  calendarProducts: MonthlyBillDocumentProduct[],
  monthStart: Date,
): { calendarDays: MonthlyBillCalendarDay[]; calendarTotals: MonthlyBillCalendarTotals } {
  const daysInMonth = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
  ).getUTCDate();

  const calendarDays: MonthlyBillCalendarDay[] = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const line = dayEntryMap.get(day);
    const products: Record<string, MonthlyBillCalendarProductCell> = {};
    let grossAmount = 0;

    calendarProducts.forEach((product) => {
      const productEntry = line?.productEntries.find((entry) => entry.product.id === product.id);
      const quantity = productEntry ? Number(productEntry.quantity) : 0;
      const rate = productEntry ? Number(productEntry.rateSnapshot) : 0;
      const amount = quantity * rate;

      grossAmount += amount;
      products[product.id] = {
        quantity: toQuantity(quantity),
        rate: toMoney(rate),
        amount: toMoney(amount),
      };
    });

    return {
      day,
      date: new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day)),
      hasEntry: Boolean(line),
      skipped: line?.skipped ?? false,
      products,
      grossAmount: toMoney(grossAmount),
    };
  });

  const calendarTotals: MonthlyBillCalendarTotals = {
    products: Object.fromEntries(
      calendarProducts.map((product) => {
        const quantity = calendarDays.reduce(
          (total, day) => total + Number(day.products[product.id]?.quantity ?? 0),
          0,
        );
        const amount = calendarDays.reduce(
          (total, day) => total + Number(day.products[product.id]?.amount ?? 0),
          0,
        );

        return [product.id, { quantity: toQuantity(quantity), amount: toMoney(amount) }];
      }),
    ),
    grossAmount: toMoney(calendarDays.reduce((total, day) => total + Number(day.grossAmount), 0)),
  };

  return { calendarDays, calendarTotals };
}

// Bills for ONE month, not every bill ever written.
//
// This used to load the whole city's history on every page load and filter it
// in the browser. That grows without bound — roughly 620 bills a month at
// current volume — and the page was already shipping a month of deliveries
// alongside it. The month is now a server round trip, the same way the
// Customer Summary tab has always worked.
export async function getMonthlyBillsPayload(input?: {
  month?: string;
}): Promise<MonthlyBillPayload> {
  const selectedMonth =
    input?.month && /^\d{4}-\d{2}$/.test(input.month) ? input.month : new Date().toISOString().slice(0, 7);
  const billingMonth = monthInputToDate(selectedMonth);

  try {
    const cityId = await getCurrentCityId();
    const [customers, routes, bills, monthRows] = await withDbTimeout(Promise.all([
      prisma.customer.findMany({
        where: { cityId, isActive: true },
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
        },
      }),
      prisma.route.findMany({
        where: { cityId, isActive: true },
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
        },
      }),
      prisma.monthlyBill.findMany({
        where: { route: { cityId }, billingMonth },
        orderBy: [{ billingMonth: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          customerId: true,
          routeId: true,
          billingMonth: true,
          openingBalance: true,
          deliveryAmount: true,
          paymentAmount: true,
          closingBalance: true,
          status: true,
          generatedAt: true,
          customer: {
            select: {
              code: true,
              name: true,
            },
          },
          route: {
            select: {
              code: true,
              name: true,
            },
          },
          items: {
            orderBy: [{ product: { displayOrder: "asc" } }, { product: { code: "asc" } }],
            select: {
              id: true,
              totalQty: true,
              averageRate: true,
              totalAmount: true,
              product: {
                select: {
                  code: true,
                  name: true,
                  shortName: true,
                  unit: true,
                },
              },
            },
          },
        },
      }),
      prisma.monthlyBill.groupBy({
        by: ["billingMonth"],
        where: { route: { cityId } },
        orderBy: { billingMonth: "desc" },
      }),
    ]), "Monthly bill data request");

    // Which months exist at all. The dropdown used to build itself from the
    // loaded bills, which stops working once only one month is loaded.
    const availableMonths = [
      ...new Set([
        selectedMonth,
        ...monthRows.map((row) => row.billingMonth.toISOString().slice(0, 7)),
      ]),
    ].sort((left, right) => right.localeCompare(left));

    return {
      dbConnected: true,
      customers,
      routes,
      selectedMonth,
      availableMonths,
      bills: bills.map((bill) => ({
        id: bill.id,
        customerId: bill.customerId,
        routeId: bill.routeId,
        billingMonth: bill.billingMonth,
        openingBalance: toMoney(bill.openingBalance),
        deliveryAmount: toMoney(bill.deliveryAmount),
        paymentAmount: toMoney(bill.paymentAmount),
        closingBalance: toMoney(bill.closingBalance),
        status: bill.status,
        generatedAt: bill.generatedAt,
        customerCode: bill.customer.code,
        customerName: bill.customer.name,
        routeCode: bill.route.code,
        routeName: bill.route.name,
        itemSummary: bill.items
          .map((item) => `${item.product.shortName ?? item.product.code} ${toQuantity(item.totalQty)} / ₹${toMoney(item.totalAmount)}`)
          .join(", "),
        items: bill.items.map((item) => ({
          id: item.id,
          productCode: item.product.code,
          productName: item.product.name,
          productShortName: item.product.shortName,
          unit: item.product.unit,
          totalQty: toQuantity(item.totalQty),
          averageRate: toMoney(item.averageRate),
          totalAmount: toMoney(item.totalAmount),
        })),
      })),
      statuses,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load monthly bill data.";

    return fallbackPayload(message, selectedMonth);
  }
}

export async function getMonthlyBillSummary(input?: {
  month?: string;
  routeId?: string;
}): Promise<MonthlyBillSummaryPayload> {
  const selectedMonth = getMonthInputValue(input?.month);
  const selectedRouteId = input?.routeId && input.routeId !== "all" ? input.routeId : "";
  const { start, end } = getMonthBounds(monthInputToDate(selectedMonth));
  const emptyTotals: MonthlyBillSummaryTotals = {
    productQuantities: {},
    deliveryAmount: "0.00",
    openingBalance: "0.00",
    paymentAmount: "0.00",
    pendingAmount: "0.00",
  };

  try {
    const cityId = await getCurrentCityId();
    const [products, routes] = await withDbTimeout(Promise.all([
      prisma.product.findMany({
        where: {
          cityId,
          isActive: true,
          showInDailyEntry: true,
        },
        orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          shortName: true,
          unit: true,
        },
      }),
      prisma.route.findMany({
        where: {
          cityId,
          isActive: true,
          ...(selectedRouteId ? { id: selectedRouteId } : {}),
        },
        orderBy: [{ shift: "asc" }, { code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          shift: true,
        },
      }),
    ]), "Monthly bill summary options request");

    const routeIds = routes.map((route) => route.id);

    if (routeIds.length === 0) {
      return {
        dbConnected: true,
        selectedMonth,
        selectedRouteId,
        selectedRouteLabel: "No route selected",
        products,
        routes: [],
        grandTotals: emptyTotals,
        outstanding: [],
        figuresAsOf: null,
      };
    }

    const [sequenceLines, bills, dailyEntries, priorBills, customerLedger, monthSequenceRows] = await withDbTimeout(Promise.all([
      prisma.monthlyRouteCustomerSequence.findMany({
        where: {
          routeId: { in: routeIds },
          sequenceMonth: start,
          status: "ACTIVE",
        },
        orderBy: [{ routeId: "asc" }, { sequenceNo: "asc" }],
        select: {
          routeId: true,
          customerId: true,
          sequenceNo: true,
          customer: {
            select: {
              code: true,
              name: true,
              area: true,
              mobile: true,
              openingBalance: true,
            },
          },
        },
      }),
      prisma.monthlyBill.findMany({
        where: {
          routeId: { in: routeIds },
          billingMonth: start,
        },
        select: {
          id: true,
          routeId: true,
          customerId: true,
          status: true,
          generatedAt: true,
          openingBalance: true,
          deliveryAmount: true,
          paymentAmount: true,
          closingBalance: true,
          items: {
            select: {
              productId: true,
              totalQty: true,
            },
          },
        },
      }),
      // City-wide for the month, NOT limited to the selected route(s): a
      // customer billed on their morning route must still have their evening
      // route's deliveries counted into that one bill, and those entries
      // belong to a route that may not be in routeIds at all.
      prisma.dailyRouteEntry.findMany({
        where: {
          route: { cityId },
          entryDate: {
            gte: start,
            lt: end,
          },
        },
        select: {
          routeId: true,
          lines: {
            select: {
              customerId: true,
              productEntries: {
                select: {
                  productId: true,
                  quantity: true,
                  rateSnapshot: true,
                },
              },
            },
          },
        },
      }),
      // Prior statements' closing balances, so an ungenerated preview carries
      // forward the same opening a real Generate would (newest bill per
      // customer wins — ordered below).
      prisma.monthlyBill.findMany({
        where: {
          route: { cityId },
          billingMonth: { lt: start },
        },
        orderBy: { billingMonth: "desc" },
        select: { customerId: true, closingBalance: true, billingMonth: true },
      }),
      // Collection ledger (verified total minus what's frozen into locked
      // bills), so the preview's Received/Pending matches what Generate would
      // write — attributed to the open bill, not by payment date.
      getCityCustomerLedger(prisma, cityId),
      // Every route each customer runs this month, city-wide — deliberately
      // NOT limited to the selected route(s). A customer on a morning AND an
      // evening route gets ONE combined bill on the route flagged billsHere,
      // and while viewing just one of those routes we still have to know
      // whether this is that route. Without this, the non-billing route can't
      // tell it isn't the billing route and re-shows the customer's whole
      // opening balance and payments — the double-count this all fixes.
      prisma.monthlyRouteCustomerSequence.findMany({
        where: { route: { cityId }, sequenceMonth: start, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        select: { customerId: true, routeId: true, billsHere: true },
      }),
    ]), "Monthly bill summary request", 8000);

    // Same resolver bill generation uses, so the summary and the bills it
    // previews can never disagree about which route carries a customer.
    const billingRoutes = resolveBillingRoutes(monthSequenceRows);

    const routeIndex = new Map(routeIds.map((routeId, index) => [routeId, index]));
    const sortedSequenceLines = selectBillingRows(sequenceLines, billingRoutes).sort((left, right) => {
      const routeSort = (routeIndex.get(left.routeId) ?? 0) - (routeIndex.get(right.routeId) ?? 0);

      return routeSort === 0 ? left.sequenceNo - right.sequenceNo : routeSort;
    });
    // Keyed by customer, not customer+route — there is one bill per customer
    // per month now, wherever it happens to be issued.
    const billMap = new Map(bills.map((bill) => [bill.customerId, bill]));
    const priorClosingMap = new Map<string, number>();
    const priorMonthMap = new Map<string, string>();
    for (const priorBill of priorBills) {
      // Ordered newest-first, so the first entry seen per customer is the
      // latest prior bill's closing balance.
      if (!priorClosingMap.has(priorBill.customerId)) {
        priorClosingMap.set(priorBill.customerId, Number(priorBill.closingBalance));
        priorMonthMap.set(priorBill.customerId, priorBill.billingMonth.toISOString().slice(0, 7));
      }
    }
    const dailyMap = new Map<
      string,
      {
        deliveryAmount: number;
        productQuantities: Map<string, number>;
      }
    >();

    // Where a customer's deliveries happened, for customers who have NO
    // sequence row left (removed mid-month). Their bill lands on the route the
    // deliveries were recorded against — see buildBillPairs' fallback — so the
    // summary has to place their row on that same route.
    const deliveryRouteByCustomer = new Map<string, string>();

    dailyEntries.forEach((entry) => {
      entry.lines.forEach((line) => {
        // Keyed by customer alone, so a customer delivered on both a morning
        // and an evening route accumulates ONE set of totals covering both —
        // matching the single combined bill they're issued.
        const key = line.customerId;
        if (!deliveryRouteByCustomer.has(key)) {
          deliveryRouteByCustomer.set(key, entry.routeId);
        }
        const current =
          dailyMap.get(key) ??
          {
            deliveryAmount: 0,
            productQuantities: new Map<string, number>(),
          };

        line.productEntries.forEach((productEntry) => {
          const quantity = Number(productEntry.quantity);
          const rate = Number(productEntry.rateSnapshot);

          current.deliveryAmount += quantity * rate;
          current.productQuantities.set(
            productEntry.productId,
            (current.productQuantities.get(productEntry.productId) ?? 0) + quantity,
          );
        });

        dailyMap.set(key, current);
      });
    });

    // Customers with deliveries this month but NO sequence row left — removed
    // from every route mid-month. They're still billed (buildBillPairs walks
    // delivery data first, so the milk they actually received is charged for),
    // and without this they'd be billed while being invisible in the very
    // screen used to check the month before generating.
    const shownCustomerIds = new Set(sortedSequenceLines.map((line) => line.customerId));
    const orphanCustomerIds = [...dailyMap.keys()].filter(
      (customerId) =>
        !shownCustomerIds.has(customerId) &&
        // Only those landing on a route currently in view.
        routeIds.includes(deliveryRouteByCustomer.get(customerId) ?? ""),
    );

    const orphanCustomers =
      orphanCustomerIds.length > 0
        ? await withDbTimeout(
            prisma.customer.findMany({
              where: { id: { in: orphanCustomerIds } },
              select: { id: true, code: true, name: true, area: true, mobile: true, openingBalance: true },
            }),
            "Monthly bill summary removed-customer request",
          )
        : [];

    const summaryLines = [
      ...sortedSequenceLines,
      ...orphanCustomers.map((customer) => ({
        // No sequence row, so no sequence number — sorted to the end of their
        // route below by this sentinel.
        routeId: deliveryRouteByCustomer.get(customer.id) ?? "",
        customerId: customer.id,
        sequenceNo: Number.MAX_SAFE_INTEGER,
        customer: {
          code: customer.code,
          name: customer.name,
          area: customer.area,
          mobile: customer.mobile,
          openingBalance: customer.openingBalance,
        },
      })),
    ];

    const rowsByRoute = new Map<string, MonthlyBillSummaryCustomerRow[]>();

    summaryLines.forEach((line) => {
      // One row per customer now, so the customer id alone identifies it — and
      // both the bill and the accumulated delivery totals are keyed that way.
      const key = line.customerId;
      const bill = billMap.get(key);
      const daily = dailyMap.get(key);
      const productQuantities = Object.fromEntries(
        products.map((product) => {
          const billItem = bill?.items.find((item) => item.productId === product.id);
          const quantity = billItem
            ? Number(billItem.totalQty)
            : (daily?.productQuantities.get(product.id) ?? 0);

          return [product.id, toQuantity(quantity)];
        }),
      );
      // When a bill exists, its stored numbers are authoritative. Otherwise the
      // preview mirrors what Generate would write: carry-forward opening (prior
      // closing), live delivery, and collections from the ledger.
      const openingBalance = bill
        ? Number(bill.openingBalance)
        : priorClosingMap.has(line.customerId)
          ? (priorClosingMap.get(line.customerId) ?? 0)
          : Number(line.customer.openingBalance);
      const deliveryAmount = bill
        ? Number(bill.deliveryAmount)
        : (daily?.deliveryAmount ?? 0);
      const paymentAmount = bill
        ? Number(bill.paymentAmount)
        : receivedAgainstOpenBill(customerLedger.get(line.customerId));
      const pendingAmount = bill
        ? Number(bill.closingBalance)
        : openingBalance + deliveryAmount - paymentAmount;
      const routeRows = rowsByRoute.get(line.routeId) ?? [];

      routeRows.push({
        key,
        sequenceNo: line.sequenceNo === Number.MAX_SAFE_INTEGER ? 0 : line.sequenceNo,
        customerId: line.customerId,
        customerCode: line.customer.code,
        customerName: line.customer.name,
        customerArea: line.customer.area,
        customerMobile: line.customer.mobile,
        productQuantities,
        deliveryAmount: toMoney(deliveryAmount),
        openingBalance: toMoney(openingBalance),
        paymentAmount: toMoney(paymentAmount),
        pendingAmount: toMoney(pendingAmount),
        source: bill ? "BILL" : "DAILY_ENTRY",
        billId: bill?.id ?? null,
        status: bill?.status ?? null,
        inSequence: line.sequenceNo !== Number.MAX_SAFE_INTEGER,
      });

      rowsByRoute.set(line.routeId, routeRows);
    });

    function buildTotals(rows: MonthlyBillSummaryCustomerRow[]): MonthlyBillSummaryTotals {
      const productQuantities = Object.fromEntries(
        products.map((product) => [
          product.id,
          toQuantity(
            rows.reduce((total, row) => total + Number(row.productQuantities[product.id] ?? 0), 0),
          ),
        ]),
      );

      return {
        productQuantities,
        deliveryAmount: toMoney(rows.reduce((total, row) => total + Number(row.deliveryAmount), 0)),
        openingBalance: toMoney(rows.reduce((total, row) => total + Number(row.openingBalance), 0)),
        paymentAmount: toMoney(rows.reduce((total, row) => total + Number(row.paymentAmount), 0)),
        pendingAmount: toMoney(rows.reduce((total, row) => total + Number(row.pendingAmount), 0)),
      };
    }

    const summaryRoutes = routes.map((route) => {
      const rows = rowsByRoute.get(route.id) ?? [];

      return {
        id: route.id,
        code: route.code,
        name: route.name,
        shift: route.shift,
        rows,
        totals: buildTotals(rows),
      };
    });
    const allRows = summaryRoutes.flatMap((route) => route.rows);
    const selectedRoute = routes.find((route) => route.id === selectedRouteId);

    // Customers carrying a balance who have no bill this month at all — off
    // every route, no deliveries — so none of the route tables above would
    // list them. The balance is real and still collectable; without this it
    // just stops being visible after the last month they were served.
    //
    // Only meaningful when looking at every route: filtered to one route, "not
    // on any route" isn't a question this view can answer.
    const billedThisMonth = new Set(allRows.map((row) => row.customerId));
    const outstandingIds = selectedRouteId
      ? []
      : [...priorClosingMap.entries()]
          .filter(([customerId, closing]) => {
            if (billedThisMonth.has(customerId)) {
              return false;
            }
            // Same arithmetic the preview rows use: carried balance less
            // whatever they've since paid that isn't frozen into a locked bill.
            const settled = closing - receivedAgainstOpenBill(customerLedger.get(customerId));
            return Math.round(settled * 100) !== 0;
          })
          .map(([customerId]) => customerId);

    const outstandingCustomers =
      outstandingIds.length > 0
        ? await withDbTimeout(
            prisma.customer.findMany({
              where: { id: { in: outstandingIds } },
              select: { id: true, code: true, name: true, mobile: true },
            }),
            "Monthly bill summary outstanding request",
          )
        : [];

    const outstanding: MonthlyBillOutstandingRow[] = outstandingCustomers
      .map((customer) => ({
        customerId: customer.id,
        customerCode: customer.code,
        customerName: customer.name,
        customerMobile: customer.mobile,
        lastBilledMonth: priorMonthMap.get(customer.id) ?? "",
        outstandingAmount: toMoney(
          (priorClosingMap.get(customer.id) ?? 0) -
            receivedAgainstOpenBill(customerLedger.get(customer.id)),
        ),
      }))
      .sort((left, right) => Number(right.outstandingAmount) - Number(left.outstandingAmount));

    // Oldest generation time among the rows actually being shown from stored
    // bills. Oldest rather than newest: it's the point beyond which SOME figure
    // on this screen stopped tracking daily entry, which is what a reader needs
    // to know. Rows previewed live don't count — they're already current.
    const shownBillIds = new Set(
      allRows.filter((row) => row.source === "BILL" && row.billId).map((row) => row.billId),
    );
    const snapshotTimes = bills
      .filter((bill) => shownBillIds.has(bill.id) && bill.generatedAt !== null)
      .map((bill) => (bill.generatedAt as Date).getTime());
    const figuresAsOf =
      snapshotTimes.length > 0 ? new Date(Math.min(...snapshotTimes)).toISOString() : null;

    return {
      dbConnected: true,
      selectedMonth,
      selectedRouteId,
      selectedRouteLabel: selectedRoute
        ? `${selectedRoute.code} - ${selectedRoute.name}`
        : "All routes",
      products,
      routes: summaryRoutes,
      grandTotals: buildTotals(allRows),
      outstanding,
      figuresAsOf,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load monthly bill summary.";

    return {
      dbConnected: false,
      selectedMonth,
      selectedRouteId,
      selectedRouteLabel: selectedRouteId ? "Selected route" : "All routes",
      products: [],
      routes: [],
      grandTotals: emptyTotals,
      outstanding: [],
      figuresAsOf: null,
      error: message,
    };
  }
}

export async function getMonthlyBillDetail(id: string): Promise<MonthlyBillDetailPayload> {
  try {
    const bill = await withDbTimeout(prisma.monthlyBill.findUnique({
      where: { id },
      select: {
        id: true,
        customerId: true,
        routeId: true,
        billingMonth: true,
        openingBalance: true,
        deliveryAmount: true,
        paymentAmount: true,
        closingBalance: true,
        status: true,
        generatedAt: true,
        customer: {
          select: {
            code: true,
            name: true,
            mobile: true,
            area: true,
            addressLine1: true,
            addressLine2: true,
          },
        },
        route: {
          select: {
            cityId: true,
            code: true,
            name: true,
            shift: true,
            driverName: true,
            driverPhone: true,
          },
        },
        items: {
          orderBy: [{ product: { displayOrder: "asc" } }, { product: { code: "asc" } }],
          select: {
            id: true,
            totalQty: true,
            averageRate: true,
            totalAmount: true,
            product: {
              select: {
                code: true,
                name: true,
                shortName: true,
                unit: true,
              },
            },
          },
        },
      },
    }), "Monthly bill detail request");

    if (!bill) {
      return { dbConnected: true };
    }

    const { start, end } = getMonthBounds(bill.billingMonth);

    // Everything below only depends on `bill` (already loaded), not on each
    // other — one round trip instead of three sequential ones.
    const [calendarProducts, businessProfile, sequenceLine, deliveryEntries, payments] = await withDbTimeout(
      Promise.all([
        prisma.product.findMany({
          where: { cityId: bill.route.cityId, isActive: true, showInDailyEntry: true },
          orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
          select: { id: true, code: true, name: true, shortName: true, unit: true },
        }),
        prisma.businessProfile.findUnique({ where: { cityId: bill.route.cityId } }),
        prisma.monthlyRouteCustomerSequence.findUnique({
          where: {
            routeId_sequenceMonth_customerId: {
              routeId: bill.routeId,
              sequenceMonth: start,
              customerId: bill.customerId,
            },
          },
          select: { sequenceNo: true },
        }),
        // Every route this customer was delivered on, not just the one the
        // bill is issued against: the bill's total covers all of them, so the
        // day-by-day calendar beside it has to as well or the two disagree.
        prisma.dailyRouteEntry.findMany({
          where: {
            route: { cityId: bill.route.cityId },
            entryDate: {
              gte: start,
              lt: end,
            },
            lines: {
              some: {
                customerId: bill.customerId,
              },
            },
          },
          orderBy: { entryDate: "asc" },
          select: {
            entryDate: true,
            lines: {
              where: {
                customerId: bill.customerId,
              },
              select: {
                id: true,
                skipped: true,
                remarks: true,
                productEntries: {
                  orderBy: [{ product: { displayOrder: "asc" } }, { product: { code: "asc" } }],
                  select: {
                    quantity: true,
                    rateSnapshot: true,
                    product: {
                      select: {
                        id: true,
                        code: true,
                        name: true,
                        shortName: true,
                        unit: true,
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        prisma.payment.findMany({
          where: {
            customerId: bill.customerId,
            routeId: bill.routeId,
            status: "VERIFIED",
            paymentDate: {
              gte: start,
              lt: end,
            },
          },
          orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            amount: true,
            paymentDate: true,
            mode: true,
            referenceNo: true,
            notes: true,
          },
        }),
      ]),
      // 5 queries share one connection under the current connection_limit=1
      // setting, so they run serially, not truly in parallel — needs a
      // longer budget than the 4s default until that limit is raised.
      "Monthly bill document request",
      10_000,
    );

    const items = bill.items.map((item) => ({
      id: item.id,
      productCode: item.product.code,
      productName: item.product.name,
      productShortName: item.product.shortName,
      unit: item.product.unit,
      totalQty: toQuantity(item.totalQty),
      averageRate: toMoney(item.averageRate),
      totalAmount: toMoney(item.totalAmount),
    }));

    // Grouped, not `new Map(...)`: a customer delivered on both a morning and
    // an evening route has TWO entries for the same date, and building the map
    // directly kept only the last one — the calendar then under-reported that
    // day against the bill total printed beside it.
    const dayEntryMap = buildMergedDayEntryMap(
      deliveryEntries.map((entry) => ({ day: entry.entryDate.getUTCDate(), line: entry.lines[0] })),
    );
    const { calendarDays, calendarTotals } = buildCalendarDays(dayEntryMap, calendarProducts, start);

    return {
      dbConnected: true,
      bill: {
        id: bill.id,
        customerId: bill.customerId,
        routeId: bill.routeId,
        billingMonth: bill.billingMonth,
        openingBalance: toMoney(bill.openingBalance),
        deliveryAmount: toMoney(bill.deliveryAmount),
        paymentAmount: toMoney(bill.paymentAmount),
        closingBalance: toMoney(bill.closingBalance),
        status: bill.status,
        generatedAt: bill.generatedAt,
        customerCode: bill.customer.code,
        customerName: bill.customer.name,
        customerMobile: bill.customer.mobile,
        customerArea: bill.customer.area,
        customerAddressLine1: bill.customer.addressLine1,
        customerAddressLine2: bill.customer.addressLine2,
        customerSequenceNo: sequenceLine?.sequenceNo ?? null,
        routeCode: bill.route.code,
        routeName: bill.route.name,
        routeShift: bill.route.shift,
        driverName: bill.route.driverName,
        driverPhone: bill.route.driverPhone,
        calendarProducts,
        calendarDays,
        calendarTotals,
        businessProfile,
        itemSummary: items
          .map((item) => `${item.productShortName ?? item.productCode} ${item.totalQty} / ₹${item.totalAmount}`)
          .join(", "),
        items,
        deliveryRows: deliveryEntries.flatMap((entry) =>
          entry.lines.map((line) => {
            const products = line.productEntries.map((productEntry) => {
              const quantity = Number(productEntry.quantity);
              const rate = Number(productEntry.rateSnapshot);

              return {
                productCode: productEntry.product.code,
                productName: productEntry.product.name,
                productShortName: productEntry.product.shortName,
                unit: productEntry.product.unit,
                quantity: toQuantity(quantity),
                rateSnapshot: toMoney(rate),
                totalAmount: toMoney(quantity * rate),
              };
            });

            return {
              id: line.id,
              entryDate: entry.entryDate,
              skipped: line.skipped,
              remarks: line.remarks,
              products,
              totalAmount: toMoney(
                products.reduce((total, product) => total + Number(product.totalAmount), 0),
              ),
            };
          }),
        ),
        payments: payments.map((payment) => ({
          id: payment.id,
          amount: toMoney(payment.amount),
          paymentDate: payment.paymentDate,
          mode: payment.mode,
          referenceNo: payment.referenceNo,
          notes: payment.notes,
        })),
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load monthly bill detail.";

    return {
      dbConnected: false,
      error: message,
    };
  }
}

export type MonthlyBillPrintBatchPayload = {
  dbConnected: boolean;
  routeCode: string;
  routeName: string;
  bills: MonthlyBillDetail[];
  error?: string;
};

export async function getMonthlyBillsForRoutePrint(
  routeId: string,
  month: string,
): Promise<MonthlyBillPrintBatchPayload> {
  try {
    const billingMonth = monthInputToDate(month);
    const { start, end } = getMonthBounds(billingMonth);

    const route = await withDbTimeout(
      prisma.route.findUnique({
        where: { id: routeId },
        select: { cityId: true, code: true, name: true, shift: true, driverName: true, driverPhone: true },
      }),
      "Route request",
    );

    if (!route) {
      return { dbConnected: true, routeCode: "", routeName: "", bills: [], error: "Route not found." };
    }

    const [calendarProducts, businessProfile, bills, sequenceLines, dailyEntries] = await withDbTimeout(
      Promise.all([
        prisma.product.findMany({
          where: { cityId: route.cityId, isActive: true, showInDailyEntry: true },
          orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
          select: { id: true, code: true, name: true, shortName: true, unit: true },
        }),
        prisma.businessProfile.findUnique({ where: { cityId: route.cityId } }),
        prisma.monthlyBill.findMany({
          where: { routeId, billingMonth: start },
          select: {
            id: true,
            customerId: true,
            openingBalance: true,
            deliveryAmount: true,
            paymentAmount: true,
            closingBalance: true,
            status: true,
            generatedAt: true,
            customer: {
              select: {
                code: true,
                name: true,
                mobile: true,
                area: true,
                addressLine1: true,
                addressLine2: true,
              },
            },
          },
        }),
        prisma.monthlyRouteCustomerSequence.findMany({
          where: { routeId, sequenceMonth: start },
          select: { customerId: true, sequenceNo: true },
        }),
        // City-wide for the month, not just this route: a customer billed here
        // may also have been delivered on their other route, and the printed
        // calendar has to account for those days too or it won't add up to the
        // bill total sitting beside it. Lines are narrowed to the printed
        // customers below.
        prisma.dailyRouteEntry.findMany({
          where: { route: { cityId: route.cityId }, entryDate: { gte: start, lt: end } },
          select: {
            entryDate: true,
            lines: {
              select: {
                customerId: true,
                skipped: true,
                productEntries: {
                  select: {
                    quantity: true,
                    rateSnapshot: true,
                    product: { select: { id: true } },
                  },
                },
              },
            },
          },
        }),
      ]),
      "Route bill print request",
      8000,
    );

    const sequenceMap = new Map(sequenceLines.map((line) => [line.customerId, line.sequenceNo]));

    // Collect per customer first, then merge each date — a `set` here dropped
    // one of the two lines whenever a customer was delivered on both a morning
    // and an evening route on the same day.
    const billedCustomerIds = new Set(bills.map((bill) => bill.customerId));
    const rowsByCustomer = new Map<string, Array<{ day: number; line: CalendarSourceLine | undefined }>>();
    dailyEntries.forEach((entry) => {
      const day = entry.entryDate.getUTCDate();

      entry.lines.forEach((line) => {
        if (!billedCustomerIds.has(line.customerId)) {
          return;
        }
        const rows = rowsByCustomer.get(line.customerId) ?? [];
        rows.push({ day, line: { skipped: line.skipped, productEntries: line.productEntries } });
        rowsByCustomer.set(line.customerId, rows);
      });
    });

    const entriesByCustomerDay = new Map<string, Map<number, CalendarSourceLine | undefined>>();
    for (const [customerId, rows] of rowsByCustomer) {
      entriesByCustomerDay.set(customerId, buildMergedDayEntryMap(rows));
    }

    const documents: MonthlyBillDetail[] = bills
      .map((bill) => {
        const dayEntryMap = entriesByCustomerDay.get(bill.customerId) ?? new Map();
        const { calendarDays, calendarTotals } = buildCalendarDays(dayEntryMap, calendarProducts, start);

        return {
          id: bill.id,
          customerId: bill.customerId,
          routeId,
          billingMonth: start,
          openingBalance: toMoney(bill.openingBalance),
          deliveryAmount: toMoney(bill.deliveryAmount),
          paymentAmount: toMoney(bill.paymentAmount),
          closingBalance: toMoney(bill.closingBalance),
          status: bill.status,
          generatedAt: bill.generatedAt,
          customerCode: bill.customer.code,
          customerName: bill.customer.name,
          customerMobile: bill.customer.mobile,
          customerArea: bill.customer.area,
          customerAddressLine1: bill.customer.addressLine1,
          customerAddressLine2: bill.customer.addressLine2,
          customerSequenceNo: sequenceMap.get(bill.customerId) ?? null,
          routeCode: route.code,
          routeName: route.name,
          routeShift: route.shift,
          driverName: route.driverName,
          driverPhone: route.driverPhone,
          calendarProducts,
          calendarDays,
          calendarTotals,
          businessProfile,
          itemSummary: "",
          items: [],
          deliveryRows: [],
          payments: [],
        };
      })
      .sort((left, right) => {
        const leftSeq = sequenceMap.get(left.customerId) ?? Number.MAX_SAFE_INTEGER;
        const rightSeq = sequenceMap.get(right.customerId) ?? Number.MAX_SAFE_INTEGER;

        return leftSeq - rightSeq || left.customerName.localeCompare(right.customerName);
      });

    return {
      dbConnected: true,
      routeCode: route.code,
      routeName: route.name,
      bills: documents,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load route bills for print.";

    return { dbConnected: false, routeCode: "", routeName: "", bills: [], error: message };
  }
}
