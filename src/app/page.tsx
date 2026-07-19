import type { ReactNode } from "react";
import { ComparisonChart, ProductContributionCharts, TrendChart } from "@/app/dashboard-charts";
import { DataTable } from "@/components/admin/data-table";
import {
  BillIcon,
  CheckIcon,
  ProductIcon,
  RouteIcon,
  SyncIcon,
  UsersIcon,
  WalletIcon,
} from "@/components/admin/icons";
import { StatusBadge } from "@/components/admin/status-badge";
import { SummaryStatBar } from "@/components/admin/summary-stat-bar";
import { cn } from "@/lib/utils";
import { getAnalyticsPayload } from "@/lib/dashboard-analytics";
import { getDashboardPayload } from "@/lib/dashboard";

function SummaryCard({
  label,
  value,
  note,
  icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  note: string;
  icon: ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  return (
    <section className="flex items-start gap-3 rounded-lg border border-surface-border bg-surface p-3.5 shadow-sm">
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          tone === "danger" && "bg-rose-50 text-rose-600",
          tone === "warning" && "bg-amber-50 text-amber-600",
          tone === "success" && "bg-emerald-50 text-emerald-700",
          tone === "default" && "bg-accent-soft text-blue-600",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-text-secondary">{label}</p>
        <p
          className={cn(
            "mt-0.5 text-xl font-bold leading-tight",
            tone === "danger" && "text-rose-600",
            tone === "warning" && "text-amber-600",
            tone === "success" && "text-emerald-700",
            tone === "default" && "text-text-primary",
          )}
        >
          {value}
        </p>
        <p className="mt-0.5 truncate text-xs text-text-secondary" title={note}>
          {note}
        </p>
      </div>
    </section>
  );
}

function formatMoney(value: string) {
  return `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

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
                <div className="text-xs text-text-secondary">{row.code}</div>
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
  searchParams?: Promise<{ from?: string; to?: string; vehicleId?: string; compareVehicleId?: string }>;
}) {
  const params = await searchParams;
  const [dashboard, analytics] = await Promise.all([
    getDashboardPayload(),
    getAnalyticsPayload({
      from: params?.from,
      to: params?.to,
      vehicleId: params?.vehicleId,
      compareVehicleId: params?.compareVehicleId,
    }),
  ]);

  return (
    <div className="space-y-4">
      {dashboard.error ? <div className="text-sm text-rose-700">{dashboard.error}</div> : null}

      <SummaryStatBar
        stats={[
          { key: "routes", label: "Active Routes", value: String(dashboard.activeRoutes) },
          { key: "customers", label: "Customers", value: String(dashboard.activeCustomers) },
          { key: "vehicles", label: "Vehicles", value: String(dashboard.activeVehicles) },
          { key: "products", label: "Products", value: String(dashboard.activeProducts) },
        ]}
      />

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Today</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
          <SummaryCard
            icon={<CheckIcon className="h-4.5 w-4.5" />}
            label="Daily Entry Today"
            value={`${dashboard.routesEnteredToday} / ${dashboard.totalActiveRoutes}`}
            note="Routes entered today"
            tone={dashboard.routesEnteredToday === dashboard.totalActiveRoutes ? "success" : "warning"}
          />
          <SummaryCard
            icon={<ProductIcon className="h-4.5 w-4.5" />}
            label="Delivered Today"
            value={`${dashboard.deliveredQuantityToday} units`}
            note={`${formatMoney(dashboard.deliveredValueToday)} value`}
          />
          <SummaryCard
            icon={<RouteIcon className="h-4.5 w-4.5" />}
            label="Reconciliation Today"
            value={`${dashboard.vehiclesReconciledToday} / ${dashboard.totalReconciliationVehicles}`}
            note="Cycles fully reconciled"
            tone={
              dashboard.vehiclesReconciledToday === dashboard.totalReconciliationVehicles &&
              dashboard.totalReconciliationVehicles > 0
                ? "success"
                : "warning"
            }
          />
          <SummaryCard
            icon={<WalletIcon className="h-4.5 w-4.5" />}
            label="Cash Sale Today"
            value={formatMoney(dashboard.cashSaleTotalToday)}
            note={dashboard.hasNegativeDifferenceToday ? "Shortage on a vehicle" : "Across all vehicles"}
            tone={dashboard.hasNegativeDifferenceToday ? "danger" : "default"}
          />
          <SummaryCard
            icon={<WalletIcon className="h-4.5 w-4.5" />}
            label="Collected Today"
            value={formatMoney(dashboard.paymentsCollectedToday)}
            note="Verified payments today"
            tone="success"
          />
          <SummaryCard
            icon={<SyncIcon className="h-4.5 w-4.5" />}
            label="Pending Payments"
            value={dashboard.pendingPaymentsCount}
            note={`${formatMoney(dashboard.pendingPaymentsAmount)} unverified`}
            tone={dashboard.pendingPaymentsCount > 0 ? "warning" : "default"}
          />
          <SummaryCard
            icon={<UsersIcon className="h-4.5 w-4.5" />}
            label="Customer Outstanding"
            value={formatMoney(dashboard.customerOutstandingTotal)}
            note="Latest bill balances"
          />
          <SummaryCard
            icon={<WalletIcon className="h-4.5 w-4.5" />}
            label="Vehicle Cash Balance"
            value={formatMoney(dashboard.vehicleCashSaleBalanceToday)}
            note="Uncollected today"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
          This month&apos;s billing cycle
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryCard
            icon={<BillIcon className="h-4.5 w-4.5" />}
            label="Bills Generated"
            value={`${dashboard.billsGeneratedThisMonth} / ${dashboard.totalCustomersDueThisMonth}`}
            note="Customers billed so far"
          />
          <SummaryCard
            icon={<BillIcon className="h-4.5 w-4.5" />}
            label="Billed vs Collected"
            value={formatMoney(dashboard.totalBilledThisMonth)}
            note={`${formatMoney(dashboard.totalCollectedThisMonth)} collected`}
          />
          <SummaryCard
            icon={<BillIcon className="h-4.5 w-4.5" />}
            label="Bill Status"
            value={`${dashboard.billsLockedCount} locked`}
            note={`${dashboard.billsDraftCount} still in draft`}
          />
        </div>
      </section>

      <section className="rounded-lg border border-surface-border bg-surface p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Today&apos;s route readiness</h2>
            <p className="text-xs text-text-secondary">Which routes have a daily entry saved for {dashboard.today}.</p>
          </div>
          <StatusBadge tone={dashboard.dbConnected ? "success" : "warning"}>
            {dashboard.dbConnected ? "Live sync" : "Fallback mode"}
          </StatusBadge>
        </div>
        <div className="mt-3">
          <DataTable
            columns={["Route", "Shift", "Vehicle", "Today's Entry"]}
            headerCellClassName="px-3 py-2"
            cellClassName="px-3 py-2 text-sm"
            rows={dashboard.routeReadiness.map((route) => ({
              key: route.routeId,
              cells: [
                <div key="route">
                  <div className="font-medium text-text-primary">{route.routeName}</div>
                  <div className="text-xs text-text-secondary">{route.routeCode}</div>
                </div>,
                route.shift === "MORNING" ? "Morning" : "Evening",
                route.vehicleName ?? "Unassigned",
                <StatusBadge key="status" tone={route.hasEntryToday ? "success" : "warning"}>
                  {route.hasEntryToday ? "Saved" : "Pending"}
                </StatusBadge>,
              ],
            }))}
            emptyMessage="No active routes yet"
          />
        </div>
      </section>

      <BreakdownTable
        title="Route Summary"
        subtitle={`Today's deliveries by route, ${dashboard.today}.`}
        products={dashboard.dailyEntryProducts}
        nameHeader="Route"
        emptyMessage="No deliveries recorded yet today"
        rows={dashboard.routeSummary.map((route) => ({
          key: route.routeId,
          code: `${route.routeCode} · ${route.shift === "MORNING" ? "Morning" : "Evening"}`,
          name: route.routeName,
          quantityByProduct: route.quantityByProduct,
          amount: route.amount,
        }))}
      />

      <BreakdownTable
        title="Cash Sale by Vehicle"
        subtitle={`Leftover milk sold for cash today, ${dashboard.today}.`}
        products={dashboard.reconciliationProducts}
        nameHeader="Vehicle"
        emptyMessage="No cash sale recorded yet today"
        rows={dashboard.vehicleCashSaleSummary.map((vehicle) => ({
          key: vehicle.vehicleId,
          code: vehicle.vehicleCode,
          name: vehicle.vehicleName,
          quantityByProduct: vehicle.quantityByProduct,
          amount: vehicle.amount,
        }))}
      />

      <section className="rounded-lg border border-surface-border bg-surface p-4 shadow-sm">
        <h2 className="text-base font-semibold text-text-primary">Analytics range</h2>
        <form action="/" className="mt-2.5 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-medium text-text-secondary">From</span>
            <input
              name="from"
              type="date"
              defaultValue={analytics.from}
              className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-medium text-text-secondary">To</span>
            <input
              name="to"
              type="date"
              defaultValue={analytics.to}
              className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-medium text-text-secondary">Vehicle</span>
            <select
              name="vehicleId"
              defaultValue={analytics.selectedVehicleId}
              className="h-10 min-w-48 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            >
              {analytics.vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.code} - {vehicle.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-medium text-text-secondary">Compare with</span>
            <select
              name="compareVehicleId"
              defaultValue={analytics.compareVehicleId}
              className="h-10 min-w-48 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            >
              {analytics.vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.code} - {vehicle.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="h-10 rounded-md border border-surface-border-strong bg-surface px-4 text-sm font-semibold text-text-secondary transition hover:bg-surface-muted"
          >
            Apply
          </button>
        </form>
      </section>

      {analytics.error ? <div className="text-sm text-rose-700">{analytics.error}</div> : null}

      <TrendChart trend={analytics.trend} />
      <ComparisonChart trend={analytics.trend} comparison={analytics.comparison} />
      <ProductContributionCharts productContribution={analytics.productContribution} />
    </div>
  );
}
