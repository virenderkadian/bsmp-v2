import type { BillingStatus, MonthlyBill, PaymentMode } from "@prisma/client";
import { getCurrentCityId } from "@/lib/current-city";
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

export type MonthlyBillSummaryPayload = {
  dbConnected: boolean;
  selectedMonth: string;
  selectedRouteId: string;
  selectedRouteLabel: string;
  products: MonthlyBillSummaryProduct[];
  routes: MonthlyBillSummaryRoute[];
  grandTotals: MonthlyBillSummaryTotals;
  error?: string;
};

const statuses: MonthlyBillPayload["statuses"] = [
  { value: "DRAFT", label: "Draft" },
  { value: "GENERATED", label: "Generated" },
  { value: "LOCKED", label: "Locked" },
  { value: "CANCELLED", label: "Cancelled" },
];

function fallbackPayload(error?: string): MonthlyBillPayload {
  return {
    dbConnected: false,
    customers: [],
    routes: [],
    bills: [],
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
  return monthValue && /^\d{4}-\d{2}$/.test(monthValue)
    ? monthValue
    : new Date().toISOString().slice(0, 7);
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

export async function getMonthlyBillsPayload(): Promise<MonthlyBillPayload> {
  try {
    const cityId = await getCurrentCityId();
    const [customers, routes, bills] = await withDbTimeout(Promise.all([
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
        where: { route: { cityId } },
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
    ]), "Monthly bill data request");

    return {
      dbConnected: true,
      customers,
      routes,
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

    return fallbackPayload(message);
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
      };
    }

    const [sequenceLines, bills, dailyEntries, verifiedPayments] = await withDbTimeout(Promise.all([
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
      prisma.dailyRouteEntry.findMany({
        where: {
          routeId: { in: routeIds },
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
      prisma.payment.findMany({
        where: {
          status: "VERIFIED",
          routeId: { in: routeIds },
          paymentDate: {
            gte: start,
            lt: end,
          },
        },
        select: {
          customerId: true,
          routeId: true,
          amount: true,
        },
      }),
    ]), "Monthly bill summary request", 8000);

    const routeIndex = new Map(routeIds.map((routeId, index) => [routeId, index]));
    const sortedSequenceLines = [...sequenceLines].sort((left, right) => {
      const routeSort = (routeIndex.get(left.routeId) ?? 0) - (routeIndex.get(right.routeId) ?? 0);

      return routeSort === 0 ? left.sequenceNo - right.sequenceNo : routeSort;
    });
    const billMap = new Map(bills.map((bill) => [`${bill.routeId}:${bill.customerId}`, bill]));
    const paymentMap = new Map<string, number>();
    const dailyMap = new Map<
      string,
      {
        deliveryAmount: number;
        productQuantities: Map<string, number>;
      }
    >();

    verifiedPayments.forEach((payment) => {
      if (!payment.routeId) {
        return;
      }

      const key = `${payment.routeId}:${payment.customerId}`;

      paymentMap.set(
        key,
        (paymentMap.get(key) ?? 0) + Number(payment.amount),
      );
    });

    dailyEntries.forEach((entry) => {
      entry.lines.forEach((line) => {
        const key = `${entry.routeId}:${line.customerId}`;
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

    const rowsByRoute = new Map<string, MonthlyBillSummaryCustomerRow[]>();

    sortedSequenceLines.forEach((line) => {
      const key = `${line.routeId}:${line.customerId}`;
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
      const openingBalance = bill
        ? Number(bill.openingBalance)
        : Number(line.customer.openingBalance);
      const deliveryAmount = bill
        ? Number(bill.deliveryAmount)
        : (daily?.deliveryAmount ?? 0);
      const paymentAmount = bill
        ? Number(bill.paymentAmount)
        : (paymentMap.get(key) ?? 0);
      const pendingAmount = bill
        ? Number(bill.closingBalance)
        : openingBalance + deliveryAmount - paymentAmount;
      const routeRows = rowsByRoute.get(line.routeId) ?? [];

      routeRows.push({
        key,
        sequenceNo: line.sequenceNo,
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
        prisma.dailyRouteEntry.findMany({
          where: {
            routeId: bill.routeId,
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

    const dayEntryMap = new Map(
      deliveryEntries.map((entry) => [entry.entryDate.getUTCDate(), entry.lines[0]]),
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
        prisma.dailyRouteEntry.findMany({
          where: { routeId, entryDate: { gte: start, lt: end } },
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

    const entriesByCustomerDay = new Map<string, Map<number, CalendarSourceLine>>();
    dailyEntries.forEach((entry) => {
      const day = entry.entryDate.getUTCDate();

      entry.lines.forEach((line) => {
        const dayMap = entriesByCustomerDay.get(line.customerId) ?? new Map();

        dayMap.set(day, { skipped: line.skipped, productEntries: line.productEntries });
        entriesByCustomerDay.set(line.customerId, dayMap);
      });
    });

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
