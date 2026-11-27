import { ComparisonChart, ProductContributionCharts, TrendChart } from "@/app/dashboard-charts";
import { LoadingBarProvider } from "@/components/admin/loading-bar";
import { DataTable } from "@/components/admin/data-table";
import { SummaryStatBar } from "@/components/admin/summary-stat-bar";
import { CashSaleCard, CollectedCard, DeliveredCard, OutstandingCard, UnsettledVehiclesCard } from "@/app/dashboard-detail-cards";
import { DashboardDateStepper } from "@/app/dashboard-date-stepper";
import { formatMoney, SummaryCard } from "@/app/summary-card";
import { RoutesByVehicle } from "@/app/routes-by-vehicle";
import { groupRoutesByVehicle } from "@/lib/dashboard-routes";
import { isUnsettled } from "@/lib/vehicle-balance";
import { todayInIndia } from "@/lib/dashboard-date";
import { getAnalyticsPayload } from "@/lib/dashboard-analytics";
import { getDashboardPayload } from "@/lib/dashboard";

function formatQty(value: string | undefined) {
  const qty = Number(value ?? 0);
  return qty === 0 ? "-" : qty.toFixed(qty % 1 === 0 ? 0 : 1);
}

function BreakdownTable({
  title,
  subtitle,
  products,
  rows,
  nameHeader,
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  products: Array<{ id: string; name: string; shortName: string | null; unit: string }>;
  rows: Array<{ key: string; code: string; name: string; quantityByProduct: Record<string, string>; amount: string }>;
  nameHeader: string;
  emptyMessage: string;
}) {
  return (
    <section className="rounded-lg border border-surface-border bg-surface p-4 shadow-sm">
      <div>
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
        <p className="text-xs text-text-secondary">{subtitle}</p>
      </div>
      <div className="mt-3">
        <DataTable
          columns={[
            nameHeader,
            ...products.map((product) => `${product.shortName ?? product.name} (${product.unit})`),
            "Amount",
          ]}
          rows={rows.map((row) => ({
            key: row.key,
            cells: [
              <div key="name">
                <div className="font-medium text-text-primary">{row.name}</div>
                {row.code ? <div className="text-xs text-text-secondary">{row.code}</div> : null}
              </div>,
              ...products.map((product) => formatQty(row.quantityByProduct[product.id])),
              <span key="amount" className="font-semibold text-text-primary">
                {formatMoney(row.amount)}
              </span>,
            ],
          }))}
          emptyMessage={emptyMessage}
          headerCellClassName="px-3 py-2"
          cellClassName="px-3 py-2 text-sm"
        />
      </div>
    </section>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ date?: string; from?: string; to?: string; vehicleId?: string; compareVehicleId?: string }>;
}) {
  const params = await searchParams;
  const [dashboard, analytics] = await Promise.all([
    getDashboardPayload({ date: params?.date }),
    getAnalyticsPayload({
      from: params?.from,
      to: params?.to,
      vehicleId: params?.vehicleId,
      compareVehicleId: params?.compareVehicleId,
    }),
  ]);

  // The date stepper and the Collected card navigate through the loading bar, whose provider
  // otherwise only wraps the reconciliation and payments sections.
  const unsettledVehicles = dashboard.vehicleBalances.filter(isUnsettled);

  return (
    <LoadingBarProvider>
    <div className="space-y-4">
      {dashboard.error ? <div className="text-sm text-status-danger-text">{dashboard.error}</div> : null}

      <SummaryStatBar
        stats={[
          { key: "routes", label: "Active Routes", value: String(dashboard.activeRoutes) },
          { key: "customers", label: "Customers", value: String(dashboard.activeCustomers) },
          { key: "vehicles", label: "Vehicles", value: String(dashboard.activeVehicles) },
          { key: "products", label: "Products", value: String(dashboard.activeProducts) },
        ]}
      />

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-text-primary">
            {dashboard.today === todayInIndia() ? "Today" : "Selected day"}
          </h2>
          <DashboardDateStepper date={dashboard.today} todayDate={todayInIndia()} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
          <SummaryCard
            label="Daily entry"
            value={`${dashboard.routesEnteredToday} / ${dashboard.totalActiveRoutes}`}
            note="Routes entered"
            tone={dashboard.routesEnteredToday === dashboard.totalActiveRoutes ? "success" : "warning"}
          />
          <DeliveredCard
            date={dashboard.today}
            rows={dashboard.deliveredByProduct}
            face={{
              label: "Delivered",
              value: `${dashboard.deliveredQuantityToday} units`,
              note: `${formatMoney(dashboard.deliveredValueToday)} value`,
            }}
          />
          <SummaryCard
            label="Reconciliation"
            value={`${dashboard.vehiclesReconciledToday} / ${dashboard.totalReconciliationVehicles}`}
            note="Cycles fully reconciled"
            tone={
              dashboard.vehiclesReconciledToday === dashboard.totalReconciliationVehicles &&
              dashboard.totalReconciliationVehicles > 0
                ? "success"
                : "warning"
            }
          />
          <CashSaleCard
            date={dashboard.today}
            rows={dashboard.cashSaleByProduct}
            face={{
              label: "Cash sale",
              value: formatMoney(dashboard.cashSaleTotalToday),
              note: dashboard.hasNegativeDifferenceToday ? "Shortage on a vehicle" : "Across all vehicles",
              tone: dashboard.hasNegativeDifferenceToday ? "danger" : "default",
            }}
          />
          <CollectedCard
            date={dashboard.today}
            face={{
              label: "Collected",
              value: formatMoney(dashboard.paymentsCollectedToday),
              note: "Verified payments",
              tone: "success",
            }}
          />
          <UnsettledVehiclesCard
            date={dashboard.today}
            rows={dashboard.vehicleBalances}
            face={{
              label: "Unsettled vehicles",
              value: `${unsettledVehicles.length} / ${dashboard.vehicleBalances.length}`,
              note: `${formatMoney(unsettledVehicles.reduce((sum, row) => sum + Number(row.balance), 0))} not yet settled`,
              tone: unsettledVehicles.length > 0 ? "warning" : "success",
            }}
          />
          <OutstandingCard
            customers={dashboard.outstandingCustomers}
            face={{
              label: "Customer outstanding",
              value: formatMoney(dashboard.customerOutstandingTotal),
              note: `${dashboard.outstandingCustomers.length} customers, as of now`,
            }}
          />
          <SummaryCard
            label="Vehicle cash balance"
            value={formatMoney(dashboard.vehicleCashSaleBalanceToday)}
            note="Not yet collected"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold text-text-primary">
          This month&apos;s billing cycle
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryCard
            label="Bills generated"
            value={`${dashboard.billsGeneratedThisMonth} / ${dashboard.totalCustomersDueThisMonth}`}
            note="Customers billed so far"
          />
          <SummaryCard
            label="Billed vs collected"
            value={formatMoney(dashboard.totalBilledThisMonth)}
            note={`${formatMoney(dashboard.totalCollectedThisMonth)} collected`}
          />
          <SummaryCard
            label="Bill status"
            value={`${dashboard.billsLockedCount} locked`}
            note={`${dashboard.billsDraftCount} still in draft`}
          />
        </div>
      </section>

      <RoutesByVehicle
        groups={groupRoutesByVehicle(dashboard.routeReadiness, dashboard.routeSummary)}
        products={dashboard.dailyEntryProducts}
        date={dashboard.today}
        live={dashboard.dbConnected}
      />

      <BreakdownTable
        title="Cash sale by vehicle"
        subtitle={`Leftover milk sold for cash, ${dashboard.today}.`}
        products={dashboard.reconciliationProducts}
        nameHeader="Vehicle"
        emptyMessage="No cash sale recorded for this date"
        rows={dashboard.vehicleCashSaleSummary.map((vehicle) => ({
          key: vehicle.vehicleId,
          code: "",
          name: vehicle.vehicleName,
          quantityByProduct: vehicle.quantityByProduct,
          amount: vehicle.amount,
        }))}
      />

      <section className="rounded-lg border border-surface-border bg-surface p-4 shadow-sm">
        <h2 className="text-base font-semibold text-text-primary">Analytics range</h2>
        <form action="/" className="mt-3 flex flex-wrap items-end gap-3">
          {params?.date ? <input type="hidden" name="date" value={dashboard.today} /> : null}
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-medium text-text-secondary">From</span>
            <input
              name="from"
              type="date"
              defaultValue={analytics.from}
              className="h-8 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-medium text-text-secondary">To</span>
            <input
              name="to"
              type="date"
              defaultValue={analytics.to}
              className="h-8 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-medium text-text-secondary">Vehicle</span>
            <select
              name="vehicleId"
              defaultValue={analytics.selectedVehicleId}
              className="h-8 w-44 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            >
              {analytics.vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-medium text-text-secondary">Compare with</span>
            <select
              name="compareVehicleId"
              defaultValue={analytics.compareVehicleId}
              className="h-8 w-44 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            >
              {analytics.vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="h-8 rounded-md border border-surface-border-strong bg-surface px-4 text-sm font-medium text-text-secondary transition hover:bg-surface-muted"
          >
            Apply
          </button>
        </form>
      </section>

      {analytics.error ? <div className="text-sm text-status-danger-text">{analytics.error}</div> : null}

      <TrendChart trend={analytics.trend} />
      <ComparisonChart trend={analytics.trend} comparison={analytics.comparison} />
      <ProductContributionCharts productContribution={analytics.productContribution} />
    </div>
    </LoadingBarProvider>
  );
}
