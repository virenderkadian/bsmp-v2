import { getCurrentCityId } from "@/lib/current-city";
import { resolveDashboardDate } from "@/lib/dashboard-date";
import { getOutstandingCustomers, type OutstandingCustomer } from "@/lib/dashboard-outstanding";
import { getReconciliationPayload } from "@/lib/reconciliation";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";

function getMonthBounds(date: Date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

export type RouteReadinessRow = {
  routeId: string;
  routeCode: string;
  routeName: string;
  shift: "MORNING" | "EVENING";
  vehicleId: string | null;
  vehicleCode: string | null;
  vehicleName: string | null;
  hasEntryToday: boolean;
};

export type DashboardProduct = { id: string; name: string; shortName: string | null; unit: string };

export type RouteSummaryRow = {
  routeId: string;
  routeCode: string;
  routeName: string;
  shift: "MORNING" | "EVENING";
  quantityByProduct: Record<string, string>;
  amount: string;
};

export type VehicleCashSaleRow = {
  vehicleId: string;
  vehicleCode: string;
  vehicleName: string;
  quantityByProduct: Record<string, string>;
  amount: string;
};

// One product's line in a card's detail: what was delivered or sold, and its worth.
export type ProductBreakdownRow = { productId: string; name: string; unit: string; quantity: string; amount: string };

// One vehicle's cash position for the selected day: balance = cash sale - payments received,
// so a positive balance is cash the vehicle has not yet handed in.
export type VehicleBalanceRow = {
  vehicleId: string;
  vehicleCode: string;
  vehicleName: string;
  cashSale: string;
  received: string;
  balance: string;
};

export type DashboardPayload = {
  dbConnected: boolean;
  today: string;

  // Today's operations
  routesEnteredToday: number;
  totalActiveRoutes: number;
  deliveredQuantityToday: string;
  deliveredValueToday: string;
  vehiclesReconciledToday: number;
  totalReconciliationVehicles: number;
  cashSaleTotalToday: string;
  hasNegativeDifferenceToday: boolean;

  // Collections & receivables
  paymentsCollectedToday: string;
  customerOutstandingTotal: string;
  vehicleCashSaleBalanceToday: string;

  // This month's billing cycle
  billsGeneratedThisMonth: number;
  totalCustomersDueThisMonth: number;
  totalBilledThisMonth: string;
  totalCollectedThisMonth: string;
  billsDraftCount: number;
  billsLockedCount: number;

  // Setup counts
  activeRoutes: number;
  activeCustomers: number;
  activeVehicles: number;
  activeProducts: number;

  routeReadiness: RouteReadinessRow[];

  dailyEntryProducts: DashboardProduct[];
  routeSummary: RouteSummaryRow[];
  reconciliationProducts: DashboardProduct[];
  vehicleCashSaleSummary: VehicleCashSaleRow[];
  deliveredByProduct: ProductBreakdownRow[];
  cashSaleByProduct: ProductBreakdownRow[];
  outstandingCustomers: OutstandingCustomer[];
  vehicleBalances: VehicleBalanceRow[];
  error?: string;
};

function fallbackPayload(today: string, error?: string): DashboardPayload {
  return {
    dbConnected: false,
    today,
    routesEnteredToday: 0,
    totalActiveRoutes: 0,
    deliveredQuantityToday: "0.000",
    deliveredValueToday: "0.00",
    vehiclesReconciledToday: 0,
    totalReconciliationVehicles: 0,
    cashSaleTotalToday: "0.00",
    hasNegativeDifferenceToday: false,
    paymentsCollectedToday: "0.00",
    customerOutstandingTotal: "0.00",
    vehicleCashSaleBalanceToday: "0.00",
    billsGeneratedThisMonth: 0,
    totalCustomersDueThisMonth: 0,
    totalBilledThisMonth: "0.00",
    totalCollectedThisMonth: "0.00",
    billsDraftCount: 0,
    billsLockedCount: 0,
    activeRoutes: 0,
    activeCustomers: 0,
    activeVehicles: 0,
    activeProducts: 0,
    routeReadiness: [],
    dailyEntryProducts: [],
    routeSummary: [],
    reconciliationProducts: [],
    vehicleCashSaleSummary: [],
    deliveredByProduct: [],
    cashSaleByProduct: [],
    outstandingCustomers: [],
    vehicleBalances: [],
    error,
  };
}

// `date` is the day the "Today" figures describe (default: today in India). The billing-cycle
// figures use that date's month. Customer outstanding is always as of now.
export async function getDashboardPayload(input?: { date?: string }): Promise<DashboardPayload> {
  const today = resolveDashboardDate(input?.date);

  try {
    const cityId = await getCurrentCityId();
    const { start: monthStart } = getMonthBounds(new Date(`${today}T00:00:00.000Z`));

    const [
      routes,
      vehicleCount,
      customerCount,
      allProducts,
      dailyEntryProducts,
      todaysEntries,
      verifiedPaymentsToday,
      outstanding,
      customersDueThisMonth,
      billsThisMonth,
      reconciliationToday,
    ] = await withDbTimeout(
      Promise.all([
        prisma.route.findMany({
          where: { cityId, isActive: true },
          orderBy: [{ shift: "asc" }, { code: "asc" }],
          select: {
            id: true,
            code: true,
            name: true,
            shift: true,
            vehicle: { select: { id: true, code: true, name: true } },
          },
        }),
        prisma.vehicle.count({ where: { cityId, isActive: true } }),
        prisma.customer.count({ where: { cityId, isActive: true } }),
        prisma.product.findMany({ where: { cityId }, select: { id: true, name: true, unit: true, isActive: true } }),
        prisma.product.findMany({
          where: { cityId, isActive: true, showInDailyEntry: true },
          orderBy: { displayOrder: "asc" },
          select: { id: true, name: true, shortName: true, unit: true },
        }),
        prisma.dailyRouteEntry.findMany({
          where: { route: { cityId }, entryDate: new Date(today) },
          select: {
            routeId: true,
            lines: {
              select: {
                productEntries: {
                  select: { productId: true, quantity: true, rateSnapshot: true },
                },
              },
            },
          },
        }),
        prisma.payment.aggregate({
          where: { status: "VERIFIED", paymentDate: new Date(today), customer: { cityId } },
          _sum: { amount: true },
        }),
        getOutstandingCustomers(cityId),
        prisma.monthlyRouteCustomerSequence.findMany({
          where: { route: { cityId }, sequenceMonth: monthStart, status: "ACTIVE" },
          distinct: ["customerId"],
          select: { customerId: true },
        }),
        prisma.monthlyBill.findMany({
          where: { route: { cityId }, billingMonth: monthStart },
          select: { status: true, deliveryAmount: true, paymentAmount: true },
        }),
        getReconciliationPayload({ cycleDate: today }),
      ]),
      "Dashboard request",
    );

    const routesEnteredToday = new Set(todaysEntries.map((entry) => entry.routeId)).size;

    let deliveredQuantityToday = 0;
    let deliveredValueToday = 0;
    for (const entry of todaysEntries) {
      for (const line of entry.lines) {
        for (const productEntry of line.productEntries) {
          const qty = Number(productEntry.quantity);
          deliveredQuantityToday += qty;
          deliveredValueToday += qty * Number(productEntry.rateSnapshot);
        }
      }
    }

    const routeSummary: RouteSummaryRow[] = todaysEntries
      .map((entry) => {
        const route = routes.find((r) => r.id === entry.routeId);
        if (!route) {
          return null;
        }

        const quantityByProduct: Record<string, number> = {};
        let amount = 0;
        for (const line of entry.lines) {
          for (const productEntry of line.productEntries) {
            const qty = Number(productEntry.quantity);
            quantityByProduct[productEntry.productId] = (quantityByProduct[productEntry.productId] ?? 0) + qty;
            amount += qty * Number(productEntry.rateSnapshot);
          }
        }

        return {
          routeId: route.id,
          routeCode: route.code,
          routeName: route.name,
          shift: route.shift,
          quantityByProduct: Object.fromEntries(
            Object.entries(quantityByProduct).map(([productId, qty]) => [productId, qty.toFixed(3)]),
          ),
          amount: amount.toFixed(2),
        };
      })
      .filter((row): row is RouteSummaryRow => row !== null);

    const vehicleCashSaleSummary: VehicleCashSaleRow[] = reconciliationToday.cycles
      .filter((cycle) => cycle.products.some((product) => Number(product.leftover) !== 0))
      .map((cycle) => ({
        vehicleId: cycle.vehicleId,
        vehicleCode: cycle.vehicleCode,
        vehicleName: cycle.vehicleName,
        quantityByProduct: Object.fromEntries(
          cycle.products.map((product) => [product.productId, product.leftover]),
        ),
        amount: cycle.cashSaleAmount,
      }));

    const customerOutstandingTotal = outstanding.total;

    const productInfo = new Map(allProducts.map((product) => [product.id, product]));
    const deliveredTotals = new Map<string, { quantity: number; amount: number }>();
    for (const entry of todaysEntries) {
      for (const line of entry.lines) {
        for (const productEntry of line.productEntries) {
          const qty = Number(productEntry.quantity);
          const current = deliveredTotals.get(productEntry.productId) ?? { quantity: 0, amount: 0 };
          current.quantity += qty;
          current.amount += qty * Number(productEntry.rateSnapshot);
          deliveredTotals.set(productEntry.productId, current);
        }
      }
    }
    const deliveredByProduct: ProductBreakdownRow[] = [...deliveredTotals.entries()]
      .filter(([, total]) => total.quantity !== 0)
      .map(([productId, total]) => ({
        productId,
        name: productInfo.get(productId)?.name ?? "Unknown product",
        unit: productInfo.get(productId)?.unit ?? "",
        quantity: total.quantity.toFixed(3),
        amount: total.amount.toFixed(2),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Cash sale = the leftover milk of every vehicle, valued at the product's rate.
    const cashTotals = new Map<string, { name: string; unit: string; quantity: number; amount: number }>();
    for (const cycle of reconciliationToday.cycles) {
      for (const product of cycle.products) {
        const quantity = Number(product.leftover);
        if (quantity === 0) continue;
        const current = cashTotals.get(product.productId) ?? { name: product.productName, unit: product.unit, quantity: 0, amount: 0 };
        current.quantity += quantity;
        current.amount += Number(product.leftoverValue);
        cashTotals.set(product.productId, current);
      }
    }
    const cashSaleByProduct: ProductBreakdownRow[] = [...cashTotals.entries()]
      .map(([productId, total]) => ({ productId, name: total.name, unit: total.unit, quantity: total.quantity.toFixed(3), amount: total.amount.toFixed(2) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const totalBilledThisMonth = billsThisMonth.reduce((sum, bill) => sum + Number(bill.deliveryAmount), 0);
    const totalCollectedThisMonth = billsThisMonth.reduce((sum, bill) => sum + Number(bill.paymentAmount), 0);
    const billsDraftCount = billsThisMonth.filter((bill) => bill.status === "DRAFT").length;
    const billsLockedCount = billsThisMonth.filter((bill) => bill.status === "LOCKED").length;

    const vehiclesReconciledToday = reconciliationToday.cycles.filter(
      (cycle) => cycle.hasEveningEntry && cycle.hasMorningEntry && cycle.hasStockEntry,
    ).length;
    const cashSaleTotalToday = reconciliationToday.cycles.reduce(
      (sum, cycle) => sum + Number(cycle.cashSaleAmount),
      0,
    );
    const hasNegativeDifferenceToday = reconciliationToday.cycles.some(
      (cycle) => Number(cycle.cashSaleAmount) < 0,
    );
    const vehicleCashSaleBalanceToday = reconciliationToday.cycles.reduce(
      (sum, cycle) => sum + Number(cycle.balance),
      0,
    );

    const routeReadiness: RouteReadinessRow[] = routes.map((route) => ({
      routeId: route.id,
      routeCode: route.code,
      routeName: route.name,
      shift: route.shift,
      vehicleId: route.vehicle?.id ?? null,
      vehicleCode: route.vehicle?.code ?? null,
      vehicleName: route.vehicle?.name ?? null,
      hasEntryToday: todaysEntries.some((entry) => entry.routeId === route.id),
    }));

    return {
      dbConnected: true,
      today,
      routesEnteredToday,
      totalActiveRoutes: routes.length,
      deliveredQuantityToday: deliveredQuantityToday.toFixed(3),
      deliveredValueToday: deliveredValueToday.toFixed(2),
      vehiclesReconciledToday,
      totalReconciliationVehicles: reconciliationToday.cycles.length,
      cashSaleTotalToday: cashSaleTotalToday.toFixed(2),
      hasNegativeDifferenceToday,
      paymentsCollectedToday: Number(verifiedPaymentsToday._sum.amount ?? 0).toFixed(2),
      customerOutstandingTotal: customerOutstandingTotal.toFixed(2),
      vehicleCashSaleBalanceToday: vehicleCashSaleBalanceToday.toFixed(2),
      billsGeneratedThisMonth: billsThisMonth.length,
      totalCustomersDueThisMonth: customersDueThisMonth.length,
      totalBilledThisMonth: totalBilledThisMonth.toFixed(2),
      totalCollectedThisMonth: totalCollectedThisMonth.toFixed(2),
      billsDraftCount,
      billsLockedCount,
      activeRoutes: routes.length,
      activeCustomers: customerCount,
      activeVehicles: vehicleCount,
      activeProducts: allProducts.filter((product) => product.isActive).length,
      routeReadiness,
      dailyEntryProducts,
      routeSummary,
      reconciliationProducts: reconciliationToday.reconciliationProducts.map((product) => ({
        id: product.id,
        name: product.name,
        shortName: null,
        unit: product.unit,
      })),
      vehicleCashSaleSummary,
      deliveredByProduct,
      cashSaleByProduct,
      outstandingCustomers: outstanding.rows,
      vehicleBalances: reconciliationToday.cycles.map((cycle) => ({
        vehicleId: cycle.vehicleId,
        vehicleCode: cycle.vehicleCode,
        vehicleName: cycle.vehicleName,
        cashSale: cycle.cashSaleAmount,
        received: cycle.paymentsReceived,
        balance: cycle.balance,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load dashboard data.";

    return fallbackPayload(today, message);
  }
}
