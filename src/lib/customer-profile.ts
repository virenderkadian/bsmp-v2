import { getCurrentCityId } from "@/lib/current-city";
import { getSingleCustomerLedger, receivedAgainstOpenBill } from "@/lib/bill-ledger";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";
import { getPaymentsPayload, type PaymentRecord } from "@/lib/payments";

function toMoney(value: unknown) {
  return Number(value).toFixed(2);
}

function toQuantity(value: unknown) {
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

export type CustomerProfileBill = {
  id: string;
  routeCode: string;
  routeName: string;
  billingMonth: Date;
  openingBalance: string;
  deliveryAmount: string;
  paymentAmount: string;
  closingBalance: string;
  status: string;
};

export type CustomerProfileRecentDelivery = {
  productId: string;
  productName: string;
  productShortName: string | null;
  unit: string;
  // Newest first, each a {date, quantity} pair — same shape stored in
  // CustomerProductRecentOrder (see schema.prisma for why this table exists
  // and why it's kept to the raw list rather than a derived average).
  entries: Array<{ date: string; quantity: string }>;
};

export type CustomerProfilePayload = {
  dbConnected: boolean;
  customer: {
    id: string;
    code: string;
    name: string;
    area: string | null;
    mobile: string | null;
    // The route(s) this customer is on for the current month, if any — a
    // customer can run a morning and an evening route at once.
    routes: Array<{ code: string; name: string; shift: string }>;
  } | null;
  // Latest bill's closing balance (or the customer's own openingBalance if
  // they have no bill yet) minus whatever's been collected against it since
  // — the exact same formula the Monthly Bills summary's outstanding rows
  // use (see getMonthlyBillSummary), not a second definition of "owes."
  outstandingBalance: string;
  totalVerifiedPayments: string;
  bills: CustomerProfileBill[];
  payments: PaymentRecord[];
  recentDeliveries: CustomerProfileRecentDelivery[];
  error?: string;
};

function fallbackPayload(error?: string): CustomerProfilePayload {
  return {
    dbConnected: false,
    customer: null,
    outstandingBalance: "0.00",
    totalVerifiedPayments: "0.00",
    bills: [],
    payments: [],
    recentDeliveries: [],
    error,
  };
}

export async function getCustomerProfilePayload(customerId: string): Promise<CustomerProfilePayload> {
  try {
    const cityId = await getCurrentCityId();
    const currentMonth = new Date();
    const sequenceMonth = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth(), 1));

    const [customer, bills, ledger, paymentsPayload, recentOrders] = await withDbTimeout(
      Promise.all([
        prisma.customer.findFirst({
          where: { id: customerId, cityId },
          select: {
            id: true,
            code: true,
            name: true,
            area: true,
            mobile: true,
            openingBalance: true,
            monthlySequences: {
              where: { sequenceMonth, status: "ACTIVE" },
              select: { route: { select: { code: true, name: true, shift: true } } },
            },
          },
        }),
        prisma.monthlyBill.findMany({
          where: { customerId, route: { cityId } },
          orderBy: { billingMonth: "desc" },
          select: {
            id: true,
            billingMonth: true,
            openingBalance: true,
            deliveryAmount: true,
            paymentAmount: true,
            closingBalance: true,
            status: true,
            route: { select: { code: true, name: true } },
          },
        }),
        getSingleCustomerLedger(prisma, cityId, customerId),
        getPaymentsPayload({ customerId, page: 1 }),
        prisma.customerProductRecentOrder.findMany({
          where: { customerId },
          select: {
            entries: true,
            product: { select: { id: true, name: true, shortName: true, unit: true } },
          },
        }),
      ]),
      "Customer profile request",
    );

    if (!customer) {
      return fallbackPayload("Customer not found.");
    }

    const latestClosing = bills.length > 0 ? Number(bills[0].closingBalance) : Number(customer.openingBalance);
    const outstandingBalance = toMoney(latestClosing - receivedAgainstOpenBill(ledger));

    return {
      dbConnected: true,
      customer: {
        id: customer.id,
        code: customer.code,
        name: customer.name,
        area: customer.area,
        mobile: customer.mobile,
        routes: customer.monthlySequences.map((sequence) => ({
          code: sequence.route.code,
          name: sequence.route.name,
          shift: sequence.route.shift,
        })),
      },
      outstandingBalance,
      totalVerifiedPayments: toMoney(ledger.totalVerified),
      bills: bills.map((bill) => ({
        id: bill.id,
        routeCode: bill.route.code,
        routeName: bill.route.name,
        billingMonth: bill.billingMonth,
        openingBalance: toMoney(bill.openingBalance),
        deliveryAmount: toMoney(bill.deliveryAmount),
        paymentAmount: toMoney(bill.paymentAmount),
        closingBalance: toMoney(bill.closingBalance),
        status: bill.status,
      })),
      payments: paymentsPayload.payments,
      recentDeliveries: recentOrders
        .map((order) => ({
          productId: order.product.id,
          productName: order.product.name,
          productShortName: order.product.shortName,
          unit: order.product.unit,
          entries: (order.entries as Array<{ date: string; quantity: number }>).map((entry) => ({
            date: entry.date,
            quantity: toQuantity(entry.quantity),
          })),
        }))
        // Most recently delivered product first.
        .sort((left, right) => (right.entries[0]?.date ?? "").localeCompare(left.entries[0]?.date ?? "")),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load customer profile.";
    return fallbackPayload(message);
  }
}
