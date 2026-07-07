import type { Payment, PaymentMode, PaymentStatus, RouteShift } from "@prisma/client";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";

export type PaymentRecord = Pick<
  Payment,
  "id" | "customerId" | "routeId" | "paymentDate" | "mode" | "status" | "referenceNo" | "notes"
> & {
  amount: string;
  customerCode: string;
  customerName: string;
  customerArea: string | null;
  routeCode: string | null;
  routeName: string | null;
  routeShift: RouteShift | null;
};

export type PaymentCustomerOption = {
  id: string;
  code: string;
  name: string;
  area: string | null;
  mobile: string | null;
};

export type PaymentRouteOption = {
  id: string;
  code: string;
  name: string;
  shift: RouteShift;
};

export type PaymentCustomerRouteLink = {
  customerId: string;
  routeId: string;
  month: string;
};

export type PaymentsPayload = {
  dbConnected: boolean;
  customers: PaymentCustomerOption[];
  routes: PaymentRouteOption[];
  customerRouteLinks: PaymentCustomerRouteLink[];
  payments: PaymentRecord[];
  modes: Array<{ value: PaymentMode; label: string }>;
  statuses: Array<{ value: PaymentStatus; label: string }>;
  error?: string;
};

export type BulkPaymentCustomerRow = {
  customerId: string;
  customerCode: string;
  customerName: string;
  customerArea: string | null;
  customerMobile: string | null;
  sequenceNo: number;
  openingOutstanding: string;
  monthlyBillAmount: string;
  alreadyPaid: string;
  pendingAmount: string;
  source: "BILL" | "ESTIMATE";
};

export type BulkPaymentPayload = {
  dbConnected: boolean;
  routes: PaymentRouteOption[];
  selectedRouteId: string;
  selectedMonth: string;
  selectedPaymentDate: string;
  routeLabel: string;
  customers: BulkPaymentCustomerRow[];
  modes: PaymentsPayload["modes"];
  statuses: PaymentsPayload["statuses"];
  error?: string;
};

const paymentModes: PaymentsPayload["modes"] = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CHEQUE", label: "Cheque" },
];

const paymentStatuses: PaymentsPayload["statuses"] = [
  { value: "PENDING", label: "Pending" },
  { value: "VERIFIED", label: "Verified" },
  { value: "CANCELLED", label: "Cancelled" },
];

function toMoney(value: unknown) {
  return Number(value).toFixed(2);
}

function getMonthInputValue(monthValue?: string) {
  return monthValue && /^\d{4}-\d{2}$/.test(monthValue)
    ? monthValue
    : new Date().toISOString().slice(0, 7);
}

function monthInputToDate(monthValue?: string) {
  return new Date(`${getMonthInputValue(monthValue)}-01T00:00:00.000Z`);
}

function getDateInputValue(dateValue?: string) {
  return dateValue && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
    ? dateValue
    : new Date().toISOString().slice(0, 10);
}

function getMonthBounds(monthValue: Date) {
  const start = new Date(Date.UTC(monthValue.getUTCFullYear(), monthValue.getUTCMonth(), 1));
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

function fallbackPayload(error?: string): PaymentsPayload {
  return {
    dbConnected: false,
    customers: [],
    routes: [],
    customerRouteLinks: [],
    payments: [],
    modes: paymentModes,
    statuses: paymentStatuses,
    error,
  };
}

export async function getPaymentsPayload(): Promise<PaymentsPayload> {
  try {
    const [customers, routes, customerRouteLinks, payments] = await withDbTimeout(Promise.all([
      prisma.customer.findMany({
        where: { isActive: true },
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          area: true,
          mobile: true,
        },
      }),
      prisma.route.findMany({
        where: { isActive: true },
        orderBy: [{ shift: "asc" }, { code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          shift: true,
        },
      }),
      prisma.monthlyRouteCustomerSequence.findMany({
        where: { status: "ACTIVE" },
        orderBy: [{ sequenceMonth: "desc" }, { route: { code: "asc" } }],
        select: {
          customerId: true,
          routeId: true,
          sequenceMonth: true,
        },
      }),
      prisma.payment.findMany({
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          customerId: true,
          routeId: true,
          amount: true,
          paymentDate: true,
          mode: true,
          status: true,
          referenceNo: true,
          notes: true,
          customer: {
            select: {
              code: true,
              name: true,
              area: true,
            },
          },
          route: {
            select: {
              code: true,
              name: true,
              shift: true,
            },
          },
        },
      }),
    ]), "Payment data request");

    return {
      dbConnected: true,
      customers,
      routes,
      customerRouteLinks: customerRouteLinks.map((link) => ({
        customerId: link.customerId,
        routeId: link.routeId,
        month: link.sequenceMonth.toISOString().slice(0, 7),
      })),
      payments: payments.map((payment) => ({
        id: payment.id,
        customerId: payment.customerId,
        routeId: payment.routeId,
        amount: toMoney(payment.amount),
        paymentDate: payment.paymentDate,
        mode: payment.mode,
        status: payment.status,
        referenceNo: payment.referenceNo,
        notes: payment.notes,
        customerCode: payment.customer.code,
        customerName: payment.customer.name,
        customerArea: payment.customer.area,
        routeCode: payment.route?.code ?? null,
        routeName: payment.route?.name ?? null,
        routeShift: payment.route?.shift ?? null,
      })),
      modes: paymentModes,
      statuses: paymentStatuses,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load payment data.";

    return fallbackPayload(message);
  }
}

export async function getBulkPaymentPayload(input?: {
  routeId?: string;
  month?: string;
  paymentDate?: string;
}): Promise<BulkPaymentPayload> {
  const selectedMonth = getMonthInputValue(input?.month);
  const selectedPaymentDate = getDateInputValue(input?.paymentDate);
  const billingMonth = monthInputToDate(selectedMonth);
  const { start, end } = getMonthBounds(billingMonth);

  try {
    const routes = await withDbTimeout(prisma.route.findMany({
      where: { isActive: true },
      orderBy: [{ shift: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        shift: true,
      },
    }), "Bulk payment route request");

    const selectedRouteId =
      input?.routeId && routes.some((route) => route.id === input.routeId)
        ? input.routeId
        : routes[0]?.id ?? "";
    const selectedRoute = routes.find((route) => route.id === selectedRouteId);

    if (!selectedRouteId) {
      return {
        dbConnected: true,
        routes,
        selectedRouteId: "",
        selectedMonth,
        selectedPaymentDate,
        routeLabel: "No active route",
        customers: [],
        modes: paymentModes,
        statuses: paymentStatuses,
      };
    }

    const [sequenceLines, bills, dailyEntries, verifiedPayments] = await withDbTimeout(Promise.all([
      prisma.monthlyRouteCustomerSequence.findMany({
        where: {
          routeId: selectedRouteId,
          sequenceMonth: billingMonth,
          status: "ACTIVE",
        },
        orderBy: { sequenceNo: "asc" },
        select: {
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
          routeId: selectedRouteId,
          billingMonth,
        },
        select: {
          customerId: true,
          openingBalance: true,
          deliveryAmount: true,
        },
      }),
      prisma.dailyRouteEntry.findMany({
        where: {
          routeId: selectedRouteId,
          entryDate: {
            gte: start,
            lt: end,
          },
        },
        select: {
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
      }),
      prisma.payment.findMany({
        where: {
          routeId: selectedRouteId,
          status: "VERIFIED",
          paymentDate: {
            gte: start,
            lt: end,
          },
        },
        select: {
          customerId: true,
          amount: true,
        },
      }),
    ]), "Bulk payment detail request", 8000);

    const billMap = new Map(bills.map((bill) => [bill.customerId, bill]));
    const dailyAmountMap = new Map<string, number>();
    const paidMap = new Map<string, number>();

    dailyEntries.forEach((entry) => {
      entry.lines.forEach((line) => {
        const total = line.productEntries.reduce(
          (sum, productEntry) =>
            sum + Number(productEntry.quantity) * Number(productEntry.rateSnapshot),
          0,
        );

        dailyAmountMap.set(line.customerId, (dailyAmountMap.get(line.customerId) ?? 0) + total);
      });
    });

    verifiedPayments.forEach((payment) => {
      paidMap.set(
        payment.customerId,
        (paidMap.get(payment.customerId) ?? 0) + Number(payment.amount),
      );
    });

    return {
      dbConnected: true,
      routes,
      selectedRouteId,
      selectedMonth,
      selectedPaymentDate,
      routeLabel: selectedRoute ? `${selectedRoute.code} - ${selectedRoute.name}` : "No active route",
      customers: sequenceLines.map((line) => {
        const bill = billMap.get(line.customerId);
        const openingOutstanding = bill
          ? Number(bill.openingBalance)
          : Number(line.customer.openingBalance);
        const monthlyBillAmount = bill
          ? Number(bill.deliveryAmount)
          : (dailyAmountMap.get(line.customerId) ?? 0);
        const alreadyPaid = paidMap.get(line.customerId) ?? 0;

        return {
          customerId: line.customerId,
          customerCode: line.customer.code,
          customerName: line.customer.name,
          customerArea: line.customer.area,
          customerMobile: line.customer.mobile,
          sequenceNo: line.sequenceNo,
          openingOutstanding: toMoney(openingOutstanding),
          monthlyBillAmount: toMoney(monthlyBillAmount),
          alreadyPaid: toMoney(alreadyPaid),
          pendingAmount: toMoney(openingOutstanding + monthlyBillAmount - alreadyPaid),
          source: bill ? "BILL" : "ESTIMATE",
        };
      }),
      modes: paymentModes,
      statuses: paymentStatuses,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load bulk payment data.";

    return {
      dbConnected: false,
      routes: [],
      selectedRouteId: input?.routeId ?? "",
      selectedMonth,
      selectedPaymentDate,
      routeLabel: "Unable to load route",
      customers: [],
      modes: paymentModes,
      statuses: paymentStatuses,
      error: message,
    };
  }
}
