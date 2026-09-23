import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { getUnusualDeliveriesReport } from "@/lib/unusual-deliveries";

function formatMonth(value: string) {
  return new Date(`${value}-01T00:00:00.000Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}

export default async function UnusualDeliveriesPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string; routeId?: string }>;
}) {
  const params = await searchParams;
  const payload = await getUnusualDeliveriesReport({ month: params?.month, routeId: params?.routeId });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Unusual Deliveries"
        subtitle="Every grid quantity this month that fell outside a customer's own recent pattern — the same check Daily Entry runs live, gathered in one place for review."
        actions={
          <Link
            href="/daily-entry"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-surface-border-strong bg-surface px-4 text-sm font-medium text-text-secondary transition hover:bg-surface-muted"
          >
            Back to Daily Entry
          </Link>
        }
      />

      {payload.error ? <div className="text-sm text-rose-700">{payload.error}</div> : null}

      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-surface-border bg-surface p-4 shadow-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="unusual-month" className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
            Month
          </label>
          <input
            id="unusual-month"
            type="month"
            name="month"
            defaultValue={payload.selectedMonth}
            className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none focus:border-accent"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="unusual-route" className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
            Route
          </label>
          <select
            id="unusual-route"
            name="routeId"
            defaultValue={payload.selectedRouteId}
            className="h-10 min-w-56 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none focus:border-accent"
          >
            {/* Nothing loads until a choice is actually submitted — this
                report used to default to every route in the city on first
                load, which was slow and, at real data volume, could exceed
                Postgres's query-parameter limit outright. */}
            <option value="" disabled>
              Select a route
            </option>
            <option value="ALL">All routes</option>
            {payload.routes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.code} - {route.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="h-10 rounded-md border border-blue-600 bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          Apply
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-surface-border bg-surface shadow-sm">
        {payload.selectedRouteId ? (
          <>
            <div className="border-b border-surface-border px-5 py-3">
              <p className="text-sm font-medium text-text-primary">
                {formatMonth(payload.selectedMonth)}
                {payload.selectedRouteId === "ALL"
                  ? " · all routes"
                  : ` · ${payload.routes.find((route) => route.id === payload.selectedRouteId)?.code ?? ""}`}
              </p>
              <p className="text-xs text-text-secondary">
                {payload.rows.length} delivery{payload.rows.length === 1 ? "" : "ies"} flagged
              </p>
            </div>

            {payload.rows.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-text-secondary">
                Nothing flagged for this month{payload.selectedRouteId === "ALL" ? "" : " on this route"}.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-surface-border">
                  <thead className="bg-surface-muted">
                    <tr>
                      <th className="px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                        Date
                      </th>
                      {payload.selectedRouteId === "ALL" ? (
                        <th className="px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                          Route
                        </th>
                      ) : null}
                      <th className="px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                        Customer
                      </th>
                      <th className="px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                        Product
                      </th>
                      <th className="px-5 py-2.5 text-right text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                        Quantity
                      </th>
                      <th className="px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                        Usually
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {payload.rows.map((row, index) => (
                      <tr key={index}>
                        <td className="px-5 py-3 text-sm text-text-secondary">{formatDate(row.date)}</td>
                        {payload.selectedRouteId === "ALL" ? (
                          <td className="px-5 py-3 text-sm text-text-secondary">{row.routeCode}</td>
                        ) : null}
                        <td className="px-5 py-3">
                          <div className="text-sm font-medium text-text-primary">{row.customerName}</div>
                          <div className="text-xs text-text-secondary">{row.customerCode}</div>
                        </td>
                        <td className="px-5 py-3 text-sm text-text-primary">{row.productLabel}</td>
                        <td className="px-5 py-3 text-right text-sm font-semibold text-amber-700">{row.quantity}</td>
                        <td className="px-5 py-3 text-sm text-text-secondary">{row.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <p className="px-5 py-10 text-center text-sm text-text-secondary">
            Select a route above to see {formatMonth(payload.selectedMonth)}&apos;s flagged deliveries.
          </p>
        )}
      </div>
    </div>
  );
}
