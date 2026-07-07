import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { PrintButton } from "@/components/admin/print-button";
import { StatusBadge } from "@/components/admin/status-badge";
import { getMonthlyBillDetail } from "@/lib/monthly-bills";
import { MonthlyBillDocument } from "@/app/monthly-bills/monthly-bill-document";

function billStatusTone(status: string) {
  if (status === "LOCKED") {
    return "success" as const;
  }

  if (status === "CANCELLED") {
    return "danger" as const;
  }

  if (status === "GENERATED") {
    return "info" as const;
  }

  return "warning" as const;
}

export default async function MonthlyBillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const payload = await getMonthlyBillDetail(id);

  if (payload.dbConnected && !payload.bill) {
    notFound();
  }

  if (!payload.bill) {
    return (
      <>
        <PageHeader
          title="Monthly Bill"
          subtitle="Unable to load this customer bill right now."
          actions={
            <Link
              href="/monthly-bills"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Back to bills
            </Link>
          }
        />
        <section className="rounded-xl border border-rose-200 bg-white p-5 text-sm text-rose-700 shadow-sm">
          {payload.error ?? "Monthly bill detail could not be loaded."}
        </section>
      </>
    );
  }

  const bill = payload.bill;
  const qrDataUrl = bill.businessProfile?.upiQrDataUrl ?? null;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`${bill.customerName} Bill`}
          subtitle={`${bill.routeCode} - ${bill.routeName}, billed month with day-wise delivery detail.`}
          actions={
            <>
              <Link
                href="/monthly-bills"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Back to bills
              </Link>
              <PrintButton label="Print bill" />
            </>
          }
        />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusBadge tone={billStatusTone(bill.status)}>{bill.status}</StatusBadge>
          {bill.customerMobile ? (
            <span className="text-sm text-slate-500">{bill.customerMobile}</span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 print:mt-0">
        <MonthlyBillDocument bill={bill} qrDataUrl={qrDataUrl} />
      </div>
    </>
  );
}
