import type { Payment, PaymentMode, PaymentStatus, RouteShift } from "@prisma/client";
import { getCurrentCityId } from "@/lib/current-city";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";
import { getCityCustomerLedger, receivedAgainstOpenBill } from "@/lib/bill-ledger";
import {
  buildCollectionRows,
  buildOffRoundCustomers,
  type SheetMoney,
} from "@/lib/collections-sheet";
import { resolveBillingRoutes } from "@/lib/monthly-bills-math";

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
  // Which round this customer is collected on. A vehicle runs a morning and an
  // evening round, and the sheet merges both, so each row has to say which.
  routeId: string;
  routeCode: string;
  shift: RouteShift;
  openingOutstanding: string;
  monthlyBillAmount: string;
  alreadyPaid: string;
  pendingAmount: string;
  source: "BILL" | "ESTIMATE";
  // True for a row found by search rather than listed on this sheet — someone
  // billed on another vehicle's round, or off the sequence entirely. Marked so
  // the sheet still shows what belonged here and what was added to it.
  offRound: boolean;
};

// A customer reachable by search but not on the selected vehicle's rounds —
// someone who pays a driver who doesn't bill them, or who has dropped off the
// sequence still owing money. Deliberately a separate, thinner shape: these
// are found deliberately, one at a time, not listed.
export type OffRoundCustomerOption = {
  customerId: string;
  customerCode: string;
  customerName: string;
  customerArea: string | null;
  routeLabel: string | null;
  outstanding: string;
  source: "BILL" | "ESTIMATE";
};

export type BulkPaymentVehicleOption = {
  id: string;
  code: string;
  name: string;
};

export type BulkPaymentPayload = {
  dbConnected: boolean;
  routes: PaymentRouteOption[];
  vehicles: BulkPaymentVehicleOption[];
  selectedVehicleId: string;
  selectedShift: RouteShift | "ALL";
  selectedRouteId: string;
  selectedMonth: string;
  selectedPaymentDate: string;
  routeLabel: string;
  customers: BulkPaymentCustomerRow[];
  // Everyone in the city who still owes money and is NOT on the rows above.
  // Small by construction (you can only collect from someone with a balance),
  // so it ships with the page rather than needing a round trip.
  offRoundCustomers: OffRoundCustomerOption[];
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
  if (monthValue && /^\d{4}-\d{2}$/.test(monthValue)) {
    return monthValue;
  }

  // Default to the previous month — the one whose bills are out for collection —
  // matching the Monthly Bills page.
  const now = new Date();
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return previous.toISOString().slice(0, 7);
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
    const cityId = await getCurrentCityId();
    const [customers, routes, customerRouteLinks, payments] = await withDbTimeout(Promise.all([
      prisma.customer.findMany({
        where: { cityId, isActive: true },
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
        where: { cityId, isActive: true },
        orderBy: [{ shift: "asc" }, { code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          shift: true,
        },
      }),
      prisma.monthlyRouteCustomerSequence.findMany({
        where: { status: "ACTIVE", route: { cityId } },
        orderBy: [{ sequenceMonth: "desc" }, { route: { code: "asc" } }],
        select: {
          customerId: true,
          routeId: true,
          sequenceMonth: true,
        },
      }),
      prisma.payment.findMany({
        where: { customer: { cityId } },
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
  vehicleId?: string;
  shift?: string;
  month?: string;
  paymentDate?: string;
}): Promise<BulkPaymentPayload> {
  const selectedMonth = getMonthInputValue(input?.month);
  const selectedPaymentDate = getDateInputValue(input?.paymentDate);
  const billingMonth = monthInputToDate(selectedMonth);
  const { start, end } = getMonthBounds(billingMonth);
  const selectedShift: RouteShift | "ALL" =
    input?.shift === "MORNING" || input?.shift === "EVENING" ? input.shift : "ALL";

  try {
    const cityId = await getCurrentCityId();
    const routes = await withDbTimeout(prisma.route.findMany({
      where: { cityId, isActive: true },
      orderBy: [{ shift: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        shift: true,
        vehicleId: true,
        vehicle: { select: { id: true, code: true, name: true } },
      },
    }), "Bulk payment route request");

    // The sheet is organised by VEHICLE, not by route: one vehicle runs a
    // morning and an evening round, and a customer taking milk on both is
    // billed on only one of them. Listing per route would hide such a
    // customer from the round they are actually visited on.
    const vehicles: BulkPaymentVehicleOption[] = [];
    const seenVehicles = new Set<string>();
    routes.forEach((route) => {
      if (route.vehicle && !seenVehicles.has(route.vehicle.id)) {
        seenVehicles.add(route.vehicle.id);
        vehicles.push({ id: route.vehicle.id, code: route.vehicle.code, name: route.vehicle.name });
      }
    });
    vehicles.sort((left, right) => left.code.localeCompare(right.code));

    const selectedVehicleId =
      input?.vehicleId && vehicles.some((vehicle) => vehicle.id === input.vehicleId)
        ? input.vehicleId
        : vehicles[0]?.id ?? "";

    // Routes this sheet covers: the selected vehicle's, narrowed by shift.
    const sheetRoutes = routes.filter(
      (route) =>
        route.vehicleId === selectedVehicleId &&
        (selectedShift === "ALL" || route.shift === selectedShift),
    );
    const sheetRouteIds = new Set(sheetRoutes.map((route) => route.id));
    const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId);

    if (!selectedVehicleId) {
      return {
        dbConnected: true,
        routes,
        vehicles,
        selectedVehicleId: "",
        selectedShift,
        selectedRouteId: "",
        selectedMonth,
        selectedPaymentDate,
        routeLabel: "No vehicle with an active route",
        customers: [],
        offRoundCustomers: [],
        modes: paymentModes,
        statuses: paymentStatuses,
      };
    }

    // Everything below is keyed by CUSTOMER, never by customer+route.
    //
    // A customer running a morning AND an evening round gets one combined
    // bill, filed against the route flagged billsHere. Scoping this page by
    // the selected route listed such a customer under BOTH rounds and, on the
    // non-billing one, found no bill and quietly fell back to an estimate
    // built from that route's deliveries alone plus the customer's static
    // opening balance. In production that showed ₹4,845 due on the morning
    // round against a real ₹8,187.50 — an operator collecting at the door
    // would have taken the smaller figure.
    // Order matters — it must match the array below.
    const [sequenceLines, bills, priorBills, dailyEntries, allCustomers, customerLedger] =
      await withDbTimeout(Promise.all([
      // The whole city's rows for the month, not just this route's: resolving
      // which route bills a customer needs to see all of their rows.
      prisma.monthlyRouteCustomerSequence.findMany({
        where: {
          route: { cityId },
          sequenceMonth: billingMonth,
          status: "ACTIVE",
        },
        // Oldest-first for the same reason generation orders this way: with no
        // billsHere row anywhere, resolveBillingRoutes falls back to the
        // earliest, and the two must agree on which that is.
        orderBy: { createdAt: "asc" },
        select: {
          customerId: true,
          routeId: true,
          billsHere: true,
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
      // Any route — the bill belongs to the customer, and it is filed against
      // whichever route carries it.
      prisma.monthlyBill.findMany({
        where: {
          route: { cityId },
          billingMonth,
        },
        select: {
          customerId: true,
          openingBalance: true,
          deliveryAmount: true,
        },
      }),
      // Carry-forward for the estimate path: before a month is generated there
      // is no bill to read an opening balance from, and the customer's static
      // openingBalance is their first-ever figure, not what they owe now.
      prisma.monthlyBill.findMany({
        where: {
          route: { cityId },
          billingMonth: { lt: billingMonth },
        },
        orderBy: { billingMonth: "desc" },
        select: { customerId: true, closingBalance: true },
      }),
      // Across every route in the city, so the estimate sums a customer's
      // whole month rather than one round of it.
      prisma.dailyRouteEntry.findMany({
        where: {
          route: { cityId },
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
      prisma.customer.findMany({
        where: { cityId, isActive: true },
        select: { id: true, code: true, name: true, area: true, openingBalance: true },
      }),
      // Collections attribute to the customer's open bill via the shared ledger
      // (verified total minus what's frozen into locked bills) — NOT by payment
      // date — so a payment entered this month against last month's bill still
      // reduces its pending here, matching what the bill itself shows.
      getCityCustomerLedger(prisma, cityId),
    ]), "Bulk payment detail request", 8000);

    const billMap = new Map(bills.map((bill) => [bill.customerId, bill]));

    // Ordered newest-first, so the first row seen per customer is their latest
    // prior closing balance.
    const priorClosingMap = new Map<string, number>();
    priorBills.forEach((bill) => {
      if (!priorClosingMap.has(bill.customerId)) {
        priorClosingMap.set(bill.customerId, Number(bill.closingBalance));
      }
    });

    const customersById = new Map(allCustomers.map((customer) => [customer.id, customer]));

    // Deliveries summed across EVERY route in the city, so a multi-route
    // customer's estimate covers their whole month rather than one round.
    const dailyAmountMap = new Map<string, number>();
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

    // Money per customer, assembled once and handed to the pure sheet builder
    // in collections-sheet.ts (which is where the rules are tested).
    const moneyByCustomer = new Map<string, SheetMoney>();
    customersById.forEach((customer, customerId) => {
      const bill = billMap.get(customerId);
      moneyByCustomer.set(customerId, {
        bill: bill
          ? { openingBalance: Number(bill.openingBalance), deliveryAmount: Number(bill.deliveryAmount) }
          : undefined,
        priorClosing: priorClosingMap.get(customerId),
        staticOpening: Number(customer.openingBalance),
        deliveredThisMonth: dailyAmountMap.get(customerId) ?? 0,
        alreadyPaid: receivedAgainstOpenBill(customerLedger.get(customerId)),
      });
    });

    const routeById = new Map(routes.map((route) => [route.id, route]));
    const shiftByRoute = new Map(routes.map((route) => [route.id, route.shift as "MORNING" | "EVENING"]));
    const sheetRows = buildCollectionRows({
      sequenceLines,
      sheetRouteIds,
      shiftByRoute,
      moneyByCustomer,
    });
    const customerBySequence = new Map(sequenceLines.map((line) => [line.customerId, line.customer]));
    const billingRoutes = resolveBillingRoutes(sequenceLines);

    const offRoundCustomers: OffRoundCustomerOption[] = buildOffRoundCustomers({
      listedCustomerIds: new Set(sheetRows.map((row) => row.customerId)),
      candidateCustomerIds: [...customersById.keys()],
      moneyByCustomer,
    })
      .map((entry) => {
        const customer = customersById.get(entry.customerId)!;
        const billingRouteId = billingRoutes.get(entry.customerId);
        const billingRoute = billingRouteId ? routeById.get(billingRouteId) : undefined;
        return {
          customerId: entry.customerId,
          customerCode: customer.code,
          customerName: customer.name,
          customerArea: customer.area,
          routeLabel: billingRoute ? billingRoute.code : null,
          outstanding: toMoney(entry.outstanding),
          source: entry.source,
        };
      })
      .sort((left, right) => left.customerCode.localeCompare(right.customerCode));

    return {
      dbConnected: true,
      routes,
      vehicles,
      selectedVehicleId,
      selectedShift,
      selectedRouteId: sheetRoutes[0]?.id ?? "",
      selectedMonth,
      selectedPaymentDate,
      routeLabel: selectedVehicle ? `${selectedVehicle.code} - ${selectedVehicle.name}` : "No vehicle",
      offRoundCustomers,
      // Presentation only — every amount and the ordering come from
      // buildCollectionRows above.
      customers: sheetRows.map((row) => {
        const customer = customerBySequence.get(row.customerId)!;
        return {
          customerId: row.customerId,
          customerCode: customer.code,
          customerName: customer.name,
          customerArea: customer.area,
          customerMobile: customer.mobile,
          routeId: row.routeId,
          routeCode: routeById.get(row.routeId)?.code ?? "",
          shift: row.shift,
          sequenceNo: row.sequenceNo,
          openingOutstanding: toMoney(row.openingOutstanding),
          monthlyBillAmount: toMoney(row.monthlyBillAmount),
          alreadyPaid: toMoney(row.alreadyPaid),
          pendingAmount: toMoney(row.pendingAmount),
          source: row.source,
          offRound: false,
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
      vehicles: [],
      selectedVehicleId: input?.vehicleId ?? "",
      selectedShift,
      selectedRouteId: "",
      selectedMonth,
      selectedPaymentDate,
      routeLabel: "Unable to load vehicle",
      customers: [],
      offRoundCustomers: [],
      modes: paymentModes,
      statuses: paymentStatuses,
      error: message,
    };
  }
}

export type BillQuickView = {
  found: boolean;
  customerName: string;
  customerCode: string;
  billingMonth: string;
  routeCode: string | null;
  status: string | null;
  openingBalance: string;
  deliveryAmount: string;
  paymentAmount: string;
  closingBalance: string;
  items: Array<{ productId: string; product: string; qty: string; rate: string; amount: string }>;
  message?: string;
};

// One customer's bill for one month, fetched only when asked for.
//
// Deliberately NOT part of the sheet payload: line items for several hundred
// customers would dwarf everything else on a page that is already loading a
// month of deliveries, and almost none of it would ever be looked at. This is
// the "let me check before I take their money" path, so it is one bill at a
// time.
export async function getBillQuickView(customerId: string, month: string): Promise<BillQuickView> {
  const billingMonth = monthInputToDate(getMonthInputValue(month));
  const empty: BillQuickView = {
    found: false,
    customerName: "",
    customerCode: "",
    billingMonth: getMonthInputValue(month),
    routeCode: null,
    status: null,
    openingBalance: "0.00",
    deliveryAmount: "0.00",
    paymentAmount: "0.00",
    closingBalance: "0.00",
    items: [],
  };

  try {
    const cityId = await getCurrentCityId();
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, cityId },
      select: { code: true, name: true },
    });

    if (!customer) {
      return { ...empty, message: "Customer not found in this city." };
    }

    const bill = await prisma.monthlyBill.findFirst({
      where: { customerId, billingMonth, route: { cityId } },
      select: {
        openingBalance: true,
        deliveryAmount: true,
        paymentAmount: true,
        closingBalance: true,
        status: true,
        route: { select: { code: true } },
        items: {
          orderBy: { product: { displayOrder: "asc" } },
          select: {
            productId: true,
            totalQty: true,
            averageRate: true,
            totalAmount: true,
            product: { select: { name: true, unit: true } },
          },
        },
      },
    });

    if (!bill) {
      return {
        ...empty,
        customerCode: customer.code,
        customerName: customer.name,
        message: "No bill generated for this month yet — the figure on the sheet is an estimate.",
      };
    }

    return {
      found: true,
      customerCode: customer.code,
      customerName: customer.name,
      billingMonth: getMonthInputValue(month),
      routeCode: bill.route.code,
      status: bill.status,
      openingBalance: toMoney(Number(bill.openingBalance)),
      deliveryAmount: toMoney(Number(bill.deliveryAmount)),
      paymentAmount: toMoney(Number(bill.paymentAmount)),
      closingBalance: toMoney(Number(bill.closingBalance)),
      items: bill.items.map((item) => ({
        productId: item.productId,
        product: `${item.product.name} (${item.product.unit})`,
        qty: String(Number(item.totalQty)),
        rate: toMoney(Number(item.averageRate)),
        amount: toMoney(Number(item.totalAmount)),
      })),
    };
  } catch (error) {
    return { ...empty, message: error instanceof Error ? error.message : "Unable to load the bill." };
  }
}
