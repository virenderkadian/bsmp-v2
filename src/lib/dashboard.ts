import { getCurrentCityId } from "@/lib/current-city";
import { getReconciliationPayload } from "@/lib/reconciliation";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

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
  pendingPaymentsCount: number;
  pendingPaymentsAmount: string;
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
    pendingPaymentsCount: 0,
    pendingPaymentsAmount: "0.00",
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
    error,
  };
}

export async function getDashboardPayload(): Promise<DashboardPayload> {
  const today = toDateInput(new Date());

  try {
    const cityId = await getCurrentCityId();
    const { start: monthStart } = getMonthBounds(new Date());

    const [
      routes,
      vehicleCount,
      customerCount,
      productCount,
      dailyEntryProducts,
      todaysEntries,
      verifiedPaymentsToday,
      pendingPayments,
      latestBillsPerCustomer,
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
            vehicle: { select: { name: true } },
          },
        }),
        prisma.vehicle.count({ where: { cityId, isActive: true } }),
        prisma.customer.count({ where: { cityId, isActive: true } }),
        prisma.product.count({ where: { cityId, isActive: true } }),
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
        prisma.payment.aggregate({
          where: { status: "PENDING", customer: { cityId } },
          _sum: { amount: true },
          _count: true,
        }),
        prisma.monthlyBill.findMany({
          where: { route: { cityId } },
          orderBy: [{ customerId: "asc" }, { billingMonth: "desc" }],
          distinct: ["customerId"],
          select: { customerId: true, closingBalance: true },
        }),
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

    const customerOutstandingTotal = latestBillsPerCustomer.reduce(
      (sum, bill) => sum + Number(bill.closingBalance),
      0,
    );

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
      pendingPaymentsCount: pendingPayments._count,
      pendingPaymentsAmount: Number(pendingPayments._sum.amount ?? 0).toFixed(2),
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
      activeProducts: productCount,
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
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load dashboard data.";

    return fallbackPayload(today, message);
  }
}
