import type { Metadata } from "next";
import { BillDocument } from "@/app/monthly-bills/bill-document";
import { DownloadBillPdfButton } from "@/components/admin/download-bill-pdf-button";
import { PrintButton } from "@/components/admin/print-button";
import { verifyBillLink } from "@/lib/bill-link";
import { buildBillPaymentQr } from "@/lib/bill-payment-qr";
import { getCitySettings } from "@/lib/city-settings";
import { setCityContext } from "@/lib/city-context";
import { getMonthlyBillDetail } from "@/lib/monthly-bills";
import { prisma } from "@/lib/prisma";
import { buildUpiUri } from "@/lib/upi-qr";

// The page behind the WhatsApp "View bill" button. Public on purpose — see
// src/lib/bill-link.ts for why the signed token is the whole access control —
// so it must be tight about what it shows: one bill, read-only, no navigation
// into the rest of the app, kept out of search engines and referrers.
export const metadata: Metadata = {
  title: "Your bill",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Notice({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-5">
      <div className="w-full rounded-2xl border border-surface-border bg-surface p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-text-primary">{title}</h1>
        <p className="mt-2 text-sm text-text-secondary">{message}</p>
      </div>
    </div>
  );
}

export default async function PublicBillPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Rejected before any database access, so junk requests cost nothing.
  const link = verifyBillLink(token);
  if (!link.ok) {
    return link.reason === "expired" ? (
      <Notice title="This link has expired" message="Please ask us to send your bill again, or contact the dairy." />
    ) : (
      <Notice title="This link isn't valid" message="Please check the link, or contact the dairy." />
    );
  }

  const head = await prisma.monthlyBill.findUnique({
    where: { id: link.billId },
    select: { status: true, route: { select: { cityId: true } } },
  });
  // A draft or cancelled bill was never issued to the customer.
  if (!head || (head.status !== "GENERATED" && head.status !== "LOCKED")) {
    return <Notice title="Bill not available" message="This bill isn't available. Please contact the dairy." />;
  }

  const cityId = head.route.cityId;
  setCityContext(cityId);
  const payload = await getMonthlyBillDetail(link.billId);
  const bill = payload.bill;
  if (!bill) {
    return <Notice title="Bill not available" message="We couldn't load this bill right now. Please try again shortly." />;
  }

  const { billFormat } = await getCitySettings(cityId);
  const qrDataUrl = await buildBillPaymentQr(bill);

  // A tap-to-pay link for a phone, carrying the same amount and note as the QR
  // (customer code first, then the month) so the credit can be matched in the
  // bank statement. Only offered when something is actually owed.
  const month = new Date(bill.billingMonth).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  const owed = Number(bill.closingBalance);
  const payLink =
    bill.payeeUpiId && owed > 0
      ? buildUpiUri(bill.payeeUpiId, bill.businessProfile?.businessName ?? "", {
          amount: bill.closingBalance,
          note: `${bill.customerCode} ${month}`,
        })
      : null;
  const filename = `${bill.customerCode}-${month.replace(" ", "-")}.pdf`;

  return (
    <div className="mx-auto max-w-5xl px-3 py-4 print:p-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-lg font-bold text-text-primary">{bill.customerName}</h1>
          <p className="text-sm text-text-secondary">
            Bill for {month} · Amount due{" "}
            <span className="font-semibold text-text-primary">
              ₹{owed.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {payLink ? (
            <a
              href={payLink}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-accent bg-accent px-4 text-sm font-semibold text-accent-contrast hover:bg-accent-hover"
            >
              Pay with UPI
            </a>
          ) : null}
          <DownloadBillPdfButton filename={filename} />
          <PrintButton label="Print bill" />
        </div>
      </div>

      <BillDocument bill={bill} qrDataUrl={qrDataUrl} format={billFormat} />
    </div>
  );
}
