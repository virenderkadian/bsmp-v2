import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { PrintButton } from "@/components/admin/print-button";
import { getMonthlyBillsForRoutePrint } from "@/lib/monthly-bills";
import { MonthlyBillDocument } from "@/app/monthly-bills/monthly-bill-document";

function formatMonth(value: string) {
  return new Date(`${value}-01T00:00:00.000Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

export default async function MonthlyBillsPrintAllPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; routeId?: string }>;
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
              className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
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

  const payload = await getMonthlyBillsForRoutePrint(routeId, month);
  const qrDataUrl = payload.bills[0]?.businessProfile?.upiQrDataUrl ?? null;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Print All Bills"
          subtitle={`${payload.routeCode ? `${payload.routeCode} - ${payload.routeName}` : "Route"} · ${formatMonth(month)} · ${payload.bills.length} bill(s)`}
          actions={
            <>
              <Link
                href="/monthly-bills"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
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
        <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm print:hidden">
          No generated bills found for this route and month yet. Generate bills first from the Monthly
          Bills screen.
        </section>
      ) : (
        <div className="mt-4 space-y-4 print:mt-0 print:space-y-0">
          {payload.bills.map((bill, index) => (
            <MonthlyBillDocument
              key={bill.id}
              bill={bill}
              qrDataUrl={qrDataUrl}
              className={index > 0 ? "print:break-before-page" : undefined}
            />
          ))}
        </div>
      )}
    </>
  );
}
