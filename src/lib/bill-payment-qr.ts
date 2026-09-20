import "server-only";
import { generateUpiQrDataUrl } from "@/lib/upi-qr";
import type { MonthlyBillDetail } from "@/lib/monthly-bills";

// The QR printed on one bill.
//
// Built per bill rather than cached once per city, because the whole point is
// that it carries this customer's amount and code. That costs roughly 2.4ms and
// 2.5KB apiece — about a quarter of a second for a route's batch print, which
// is why the batch is per route and not per city.
//
// Returns null when there is no payee id to pay, so the bill simply prints
// without a QR instead of printing a QR that goes nowhere.
export async function buildBillPaymentQr(bill: MonthlyBillDetail): Promise<string | null> {
  if (!bill.payeeUpiId) {
    return null;
  }

  const month = new Date(bill.billingMonth).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  return generateUpiQrDataUrl(
    bill.payeeUpiId,
    bill.businessProfile?.businessName ?? "",
    {
      amount: bill.closingBalance,
      // Customer code first: some apps truncate the note, and the code is the
      // part that identifies the credit.
      note: `${bill.customerCode} ${month}`,
    },
  );
}
