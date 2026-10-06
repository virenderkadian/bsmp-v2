import Link from "next/link";
import { notFound } from "next/navigation";
import { DataTable } from "@/components/admin/data-table";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { SummaryStatBar, type SummaryStatItem } from "@/components/admin/summary-stat-bar";
import { getCustomerProfilePayload } from "@/lib/customer-profile";

function formatMoney(value: string) {
  return `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatMonth(value: Date) {
  return new Date(value).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function formatDate(value: Date) {
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function billStatusTone(status: string) {
  if (status === "LOCKED") return "success" as const;
  if (status === "CANCELLED") return "danger" as const;
  if (status === "GENERATED") return "info" as const;
  return "warning" as const;
}

function paymentStatusTone(status: string) {
  if (status === "VERIFIED") return "success" as const;
  if (status === "CANCELLED") return "danger" as const;
  return "warning" as const;
}

export default async function CustomerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const payload = await getCustomerProfilePayload(id);

  if (payload.dbConnected && !payload.customer) {
    notFound();
  }

  if (!payload.customer) {
    return (
      <>
        <PageHeader
          title="Customer"
          subtitle="Unable to load this customer right now."
          actions={
            <Link
              href="/customers"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-surface-border-strong bg-surface px-4 text-sm font-medium text-text-secondary transition hover:bg-surface-muted"
            >
              Back to customers
            </Link>
          }
        />
        <section className="rounded-xl border border-rose-200 bg-surface p-5 text-sm text-rose-700 shadow-sm">
          {payload.error ?? "Customer could not be loaded."}
        </section>
      </>
    );
  }

  const customer = payload.customer;
  const lastPayment = payload.payments[0];
  const lastDelivery = payload.recentDeliveries[0]?.entries[0];

  const stats: SummaryStatItem[] = [
    { key: "outstanding", label: "Outstanding", value: formatMoney(payload.outstandingBalance), tone: "danger" },
    { key: "verified", label: "Total paid", value: formatMoney(payload.totalVerifiedPayments), tone: "success" },
    {
      key: "last-payment",
      label: "Last payment",
      value: lastPayment ? `${formatMoney(lastPayment.amount)} · ${formatDate(lastPayment.paymentDate)}` : "—",
    },
    {
      key: "last-delivery",
      label: "Last delivery",
      value: lastDelivery ? formatDate(new Date(lastDelivery.date)) : "—",
    },
  ];

  return (
    <>
      <PageHeader
        title={customer.name}
        subtitle={[customer.code, customer.area, customer.mobile].filter(Boolean).join(" · ")}
        actions={
          <Link
            href="/customers"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-surface-border-strong bg-surface px-4 text-sm font-medium text-text-secondary transition hover:bg-surface-muted"
          >
            Back to customers
          </Link>
        }
      />

      {customer.routes.length > 0 ? (
        <p className="text-sm text-text-secondary">
          On {customer.routes.map((route) => `${route.code} (${route.shift === "EVENING" ? "Evening" : "Morning"})`).join(", ")} this month
        </p>
      ) : (
        <p className="text-sm text-text-secondary">Not on any route this month.</p>
      )}

      <SummaryStatBar stats={stats} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-primary">Monthly bills</h2>
        <DataTable
          columns={["Month", "Route", "Opening", "Delivery", "Paid", "Closing", "Status"]}
          emptyMessage="No bills yet."
          rows={payload.bills.map((bill) => ({
            key: bill.id,
            cells: [
              <Link key="month" href={`/monthly-bills/${bill.id}`} className="font-medium text-accent hover:underline">
                {formatMonth(bill.billingMonth)}
              </Link>,
              `${bill.routeCode} - ${bill.routeName}`,
              formatMoney(bill.openingBalance),
              formatMoney(bill.deliveryAmount),
              formatMoney(bill.paymentAmount),
              formatMoney(bill.closingBalance),
              <StatusBadge key="status" tone={billStatusTone(bill.status)}>
                {bill.status}
              </StatusBadge>,
            ],
          }))}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-primary">Payment history</h2>
        <DataTable
          columns={["Date", "Amount", "Mode", "Status", "Route", "Reference"]}
          emptyMessage="No payments recorded yet."
          rows={payload.payments.map((payment) => ({
            key: payment.id,
            cells: [
              formatDate(payment.paymentDate),
              formatMoney(payment.amount),
              payment.mode,
              <StatusBadge key="status" tone={paymentStatusTone(payment.status)}>
                {payment.status}
              </StatusBadge>,
              payment.routeCode ? `${payment.routeCode} - ${payment.routeName}` : "Unallocated",
              payment.referenceNo || payment.notes || "—",
            ],
          }))}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-primary">Recent deliveries</h2>
        {payload.recentDeliveries.length === 0 ? (
          <p className="rounded-xl border border-surface-border bg-surface p-5 text-sm text-text-secondary shadow-sm">
            No delivery history yet.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {payload.recentDeliveries.map((product) => (
              <div key={product.productId} className="rounded-xl border border-surface-border bg-surface p-4 shadow-sm">
                <p className="text-sm font-semibold text-text-primary">{product.productShortName ?? product.productName}</p>
                <ul className="mt-2 space-y-1">
                  {product.entries.slice(0, 5).map((entry) => (
                    <li key={entry.date} className="flex items-center justify-between text-xs text-text-secondary">
                      <span>{formatDate(new Date(entry.date))}</span>
                      <span className="font-medium text-text-primary">
                        {entry.quantity} {product.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
