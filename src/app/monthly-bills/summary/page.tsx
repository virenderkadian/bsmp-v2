import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { getMonthlyBillSummary, type MonthlyBillSummaryTotals } from "@/lib/monthly-bills";
import { PrintSummaryButton } from "@/app/monthly-bills/summary/print-summary-button";

function formatMonth(value: string) {
  return new Date(`${value}-01T00:00:00.000Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function formatMoney(value: string) {
  return `Rs ${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatQty(value: string, emptyZero = true) {
  const quantity = Number(value);

  if (emptyZero && quantity === 0) {
    return "-";
  }

  return quantity.toLocaleString("en-IN", {
    maximumFractionDigits: 3,
  });
}

function TotalsRow({
  label,
  totals,
  productIds,
}: {
  label: string;
  totals: MonthlyBillSummaryTotals;
  productIds: string[];
}) {
  return (
    <tr className="bg-slate-100 text-sm font-bold text-slate-900">
      <td className="border-t border-slate-300 px-3 py-2 text-center" colSpan={2}>
        {label}
      </td>
      {productIds.map((productId) => (
        <td key={productId} className="border-t border-slate-300 px-3 py-2 text-right">
          {formatQty(totals.productQuantities[productId] ?? "0", false)}
        </td>
      ))}
      <td className="border-t border-slate-300 px-3 py-2 text-right">
        {formatMoney(totals.deliveryAmount)}
      </td>
      <td className="border-t border-slate-300 px-3 py-2 text-right">
        {formatMoney(totals.openingBalance)}
      </td>
      <td className="border-t border-slate-300 px-3 py-2 text-right">
        {formatMoney(totals.paymentAmount)}
      </td>
      <td className="border-t border-slate-300 px-3 py-2 text-right">
        {formatMoney(totals.pendingAmount)}
      </td>
    </tr>
  );
}

export default async function MonthlyBillSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; routeId?: string }>;
}) {
  const params = await searchParams;
  const payload = await getMonthlyBillSummary({
    month: params.month,
    routeId: params.routeId,
  });
  const productIds = payload.products.map((product) => product.id);
  const routeCount = payload.routes.length;
  const rowCount = payload.routes.reduce((total, route) => total + route.rows.length, 0);

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Monthly Bill Summary"
          subtitle={`${formatMonth(payload.selectedMonth)} · ${payload.selectedRouteLabel}`}
          actions={
            <>
              <Link
                href="/monthly-bills"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Back to bills
              </Link>
              <PrintSummaryButton />
            </>
          }
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <div className="mb-4 flex flex-col gap-3 border-b border-slate-200 pb-4 print:mb-3 print:pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Dairy Admin Standard
              </p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900 print:text-xl">
                Monthly Bill Summary
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {formatMonth(payload.selectedMonth)} · {payload.selectedRouteLabel}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={payload.dbConnected ? "success" : "warning"}>
                {payload.dbConnected ? "Live data" : "Fallback"}
              </StatusBadge>
              <StatusBadge tone="info">{routeCount} routes</StatusBadge>
              <StatusBadge tone="info">{rowCount} customers</StatusBadge>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Customers are printed in Monthly Route Customer Sequence order. Rows without a generated
            bill use current Daily Entry totals as a fallback.
          </p>
        </div>

        {payload.error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {payload.error}
          </div>
        ) : null}

        <div className="space-y-5">
          {payload.routes.map((route) => (
            <section key={route.id} className="break-inside-avoid rounded-lg border border-slate-200 print:border-slate-300">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    {route.code} - {route.name}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {route.shift} · {route.rows.length} customers
                  </p>
                </div>
              </div>
              {route.rows.length === 0 ? (
                <p className="px-4 py-5 text-sm text-slate-500">
                  No monthly sequence customers found for this route and month.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                        <th className="w-16 border-b border-slate-200 px-3 py-2 text-left">Sr</th>
                        <th className="min-w-52 border-b border-slate-200 px-3 py-2 text-left">
                          Customer
                        </th>
                        {payload.products.map((product) => (
                          <th
                            key={product.id}
                            className="min-w-24 border-b border-slate-200 px-3 py-2 text-right"
                          >
                            {product.shortName ?? product.code}
                          </th>
                        ))}
                        <th className="min-w-28 border-b border-slate-200 px-3 py-2 text-right">
                          Amount
                        </th>
                        <th className="min-w-28 border-b border-slate-200 px-3 py-2 text-right">
                          Opening
                        </th>
                        <th className="min-w-28 border-b border-slate-200 px-3 py-2 text-right">
                          Paid
                        </th>
                        <th className="min-w-28 border-b border-slate-200 px-3 py-2 text-right">
                          Pending
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {route.rows.map((row) => (
                        <tr key={row.key} className="text-slate-700">
                          <td className="px-3 py-2 text-slate-500">{row.sequenceNo}</td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-slate-900">{row.customerName}</div>
                            <div className="text-xs text-slate-500">
                              {row.customerCode}
                              {row.customerArea ? ` · ${row.customerArea}` : ""}
                              {row.customerMobile ? ` · ${row.customerMobile}` : ""}
                              {row.source === "DAILY_ENTRY" ? " · live fallback" : ""}
                            </div>
                          </td>
                          {productIds.map((productId) => (
                            <td key={productId} className="px-3 py-2 text-right">
                              {formatQty(row.productQuantities[productId] ?? "0")}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right font-medium text-slate-900">
                            {formatMoney(row.deliveryAmount)}
                          </td>
                          <td className="px-3 py-2 text-right">{formatMoney(row.openingBalance)}</td>
                          <td className="px-3 py-2 text-right">{formatMoney(row.paymentAmount)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900">
                            {formatMoney(row.pendingAmount)}
                          </td>
                        </tr>
                      ))}
                      <TotalsRow label="Route Total" totals={route.totals} productIds={productIds} />
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>

        {payload.routes.length > 1 ? (
          <section className="mt-5 rounded-lg border border-slate-300 bg-white">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h2 className="text-base font-semibold text-slate-900">Grand Total</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <tbody>
                  <TotalsRow
                    label="All Routes"
                    totals={payload.grandTotals}
                    productIds={productIds}
                  />
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </section>
    </>
  );
}
