import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { PrintButton } from "@/components/admin/print-button";
import { getMonthlyBillsForRoutePrint } from "@/lib/monthly-bills";
import { billFiltersFromParams, describeBillFilters, matchesBillFilters } from "@/lib/bill-filters";
import { getCitySettings } from "@/lib/city-settings";
import { getCurrentCityId } from "@/lib/current-city";
import { BillDocument } from "@/app/monthly-bills/bill-document";

function formatMonth(value: string) {
  return new Date(`${value}-01T00:00:00.000Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

export default async function MonthlyBillsPrintAllPage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string;
    routeId?: string;
    status?: string;
    search?: string;
    amountField?: string;
    minAmount?: string;
    maxAmount?: string;
  }>;
}) {
  const params = await searchParams;
  const month = params.month ?? new Date().toISOString().slice(0, 7);
  const routeId = params.routeId ?? "";

  if (!routeId) {
    return (
      <>
        <PageHeader
          title="Print All Bills"
          subtitle="Select a route to print all generated bills for that route and month."
          actions={
            <Link
              href="/monthly-bills"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-surface-border-strong bg-surface px-4 text-sm font-medium text-text-secondary transition hover:bg-surface-muted"
            >
              Back to bills
            </Link>
          }
        />
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 shadow-sm">
          Pick a specific route on the Monthly Bills screen, then use &ldquo;Print all bills&rdquo; from there.
        </section>
      </>
    );
  }

  // Applied here, not on the screen: this is a separate route, so a filter that
  // is not in the URL simply does not reach the paper.
  const filters = billFiltersFromParams(params);
  const loaded = await getMonthlyBillsForRoutePrint(routeId, month, params.status);
  const payload = {
    ...loaded,
    // Status is already applied by the loader; the rest are the same rules the
    // screen runs, from src/lib/bill-filters.ts. closingBalance is what the
    // Summary calls pendingAmount — the same figure under two names.
    bills: loaded.bills.filter((bill) =>
      matchesBillFilters({ ...bill, pendingAmount: bill.closingBalance }, filters),
    ),
  };
  const filterNotice = describeBillFilters(filters);
  const { billFormat } = await getCitySettings(await getCurrentCityId());
  const qrDataUrl = payload.bills[0]?.businessProfile?.upiQrDataUrl ?? null;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Print All Bills"
          subtitle={`${payload.routeCode ? `${payload.routeCode} - ${payload.routeName}` : "Route"} · ${formatMonth(month)} · ${payload.bills.length} bill(s)${
            filterNotice ? ` · ${filterNotice}` : ""
          }`}
          actions={
            <>
              <Link
                href="/monthly-bills"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-surface-border-strong bg-surface px-4 text-sm font-medium text-text-secondary transition hover:bg-surface-muted"
              >
                Back to bills
              </Link>
              {payload.bills.length > 0 ? <PrintButton label="Print all" /> : null}
            </>
          }
        />

        {payload.error ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {payload.error}
          </div>
        ) : null}
      </div>

      {payload.bills.length === 0 && !payload.error ? (
        <section className="rounded-xl border border-surface-border bg-surface p-5 text-sm text-text-secondary shadow-sm print:hidden">
          No generated bills found for this route and month yet. Generate bills first from the Monthly
          Bills screen.
        </section>
      ) : (
        <div className="mt-4 space-y-4 print:mt-0 print:space-y-0">
          {payload.bills.map((bill, index) => (
            <BillDocument
              key={bill.id}
              bill={bill}
              qrDataUrl={qrDataUrl}
              format={billFormat}
              className={index > 0 ? "print:break-before-page" : undefined}
            />
          ))}
        </div>
      )}
    </>
  );
}
