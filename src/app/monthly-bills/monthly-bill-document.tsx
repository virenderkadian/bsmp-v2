import { Fragment } from "react";
import type { MonthlyBillDetail } from "@/lib/monthly-bills";

function formatMoney(value: string | number) {
  return `Rs ${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatRate(value: string) {
  const rate = Number(value);
  return rate % 1 === 0 ? `Rs ${rate}` : `Rs ${rate.toFixed(2)}`;
}

function formatQuantity(value: string) {
  const quantity = Number(value);

  if (quantity === 0) {
    return "";
  }

  return quantity.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function formatMonthTitle(value: Date) {
  return new Date(value)
    .toLocaleDateString("en-IN", { month: "short", year: "numeric" })
    .toUpperCase();
}

function formatDay(value: Date) {
  return new Date(value).getUTCDate();
}

// The rate a product billed at for this customer this month — taken from the
// first day it was actually delivered, since it's shown once in the column
// header rather than repeated on every row.
function getHeaderRate(bill: MonthlyBillDetail, productId: string): string | null {
  for (const day of bill.calendarDays) {
    const cell = day.products[productId];

    if (cell && Number(cell.quantity) > 0) {
      return cell.rate;
    }
  }

  return null;
}

export function MonthlyBillDocument({
  bill,
  qrDataUrl,
  className,
}: {
  bill: MonthlyBillDetail;
  qrDataUrl: string | null;
  className?: string;
}) {
  const profile = bill.businessProfile;

  return (
    <article className={`bill-document rounded-lg border border-slate-300 bg-white p-4 text-xs text-slate-900 print:rounded-none print:border-0 print:p-0 print:text-xs ${className ?? ""}`}>
      <header className="text-center">
        <h1 className="text-sm font-bold uppercase tracking-wide">
          {profile?.businessName ?? "Business name not set"}
        </h1>
        <p className="mt-0.5 text-slate-600">
          {[
            profile?.contactPhone ? `Contact: ${profile.contactPhone}` : null,
            [profile?.addressLine1, profile?.addressLine2].filter(Boolean).join(", ") || null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 border-y border-slate-300 py-1.5 print:mt-1 print:py-1">
        <p className="font-semibold">
          BILL OF — {formatMonthTitle(bill.billingMonth)}
          <span className="mx-1.5 font-normal text-slate-400">·</span>
          <span className="font-normal">SR No: {bill.customerSequenceNo ?? "-"}</span>
          <span className="mx-1.5 font-normal text-slate-400">·</span>
          <span className="font-normal">{bill.customerName}</span>
        </p>
        {bill.driverName ? (
          <p className="text-slate-600">
            Driver: {bill.driverName}
            {bill.driverPhone ? ` · ${bill.driverPhone}` : ""}
          </p>
        ) : null}
      </div>

      <div className="mt-2 overflow-x-auto print:mt-1">
        <table className="w-full min-w-full border-collapse text-xs print:text-[11px]">
          <thead>
            <tr className="bg-slate-100">
              <th rowSpan={2} className="border border-slate-300 px-1.5 py-1.5 print:py-1 text-left align-middle">
                Date
              </th>
              {bill.calendarProducts.map((product) => {
                const rate = getHeaderRate(bill, product.id);

                return (
                  <th key={product.id} colSpan={2} className="border border-slate-300 px-1.5 py-1.5 print:py-1">
                    {product.name}
                    {rate ? <span className="font-normal text-slate-500"> ({formatRate(rate)})</span> : null}
                  </th>
                );
              })}
              <th rowSpan={2} className="border border-slate-300 px-1.5 py-1.5 print:py-1 align-middle">
                Gross Amt
              </th>
            </tr>
            <tr className="bg-slate-100">
              {bill.calendarProducts.map((product) => (
                <Fragment key={product.id}>
                  <th className="border border-slate-300 px-1.5 py-1.5 print:py-1 font-medium">Qty</th>
                  <th className="border border-slate-300 px-1.5 py-1.5 print:py-1 font-medium">Amt</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {bill.calendarDays.map((day) => {
              const isBlank = !day.hasEntry || day.skipped;

              return (
                <tr key={day.day} className={isBlank ? "text-slate-300" : undefined}>
                  <td className="border border-slate-300 px-1.5 py-1.5 print:py-1">{formatDay(day.date)}</td>
                  {bill.calendarProducts.map((product) => {
                    const cell = day.products[product.id];
                    const hasQty = Number(cell.quantity) > 0;

                    return (
                      <Fragment key={product.id}>
                        <td className="border border-slate-300 px-1.5 py-1.5 print:py-1 text-right">
                          {hasQty ? formatQuantity(cell.quantity) : ""}
                        </td>
                        <td className="border border-slate-300 px-1.5 py-1.5 print:py-1 text-right">
                          {hasQty ? formatMoney(cell.amount) : ""}
                        </td>
                      </Fragment>
                    );
                  })}
                  <td className="border border-slate-300 px-1.5 py-1.5 print:py-1 text-right">
                    {Number(day.grossAmount) > 0 ? formatMoney(day.grossAmount) : ""}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-slate-100 font-semibold">
              <td className="border border-slate-300 px-1.5 py-1.5 print:py-1">Total</td>
              {bill.calendarProducts.map((product) => (
                <Fragment key={product.id}>
                  <td className="border border-slate-300 px-1.5 py-1.5 print:py-1 text-right">
                    {Number(bill.calendarTotals.products[product.id]?.quantity ?? 0).toLocaleString("en-IN", {
                      maximumFractionDigits: 3,
                    })}
                  </td>
                  <td className="border border-slate-300 px-1.5 py-1.5 print:py-1 text-right">
                    {formatMoney(bill.calendarTotals.products[product.id]?.amount ?? "0")}
                  </td>
                </Fragment>
              ))}
              <td className="border border-slate-300 px-1.5 py-1.5 print:py-1 text-right">
                {formatMoney(bill.calendarTotals.grossAmount)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-2 ml-auto max-w-xs space-y-0.5 print:mt-1">
        <div className="flex justify-between">
          <span>Previous Balance</span>
          <span>{formatMoney(bill.openingBalance)}</span>
        </div>
        <div className="flex justify-between">
          <span>Milk/Product Total (+)</span>
          <span>{formatMoney(bill.deliveryAmount)}</span>
        </div>
        <div className="flex justify-between text-emerald-700">
          <span>Payment Received (-)</span>
          <span>{formatMoney(bill.paymentAmount)}</span>
        </div>
        <div className="flex justify-between border-t border-slate-300 pt-0.5 text-sm font-bold text-rose-700">
          <span>Balance Amount</span>
          <span>{formatMoney(bill.closingBalance)}</span>
        </div>
      </div>

      {profile ? (
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-slate-300 pt-2 print:mt-1 print:pt-1">
          <div className="flex items-start gap-3">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- printed document, no next/image optimization needed
              <img src={qrDataUrl} alt="UPI QR code" width={72} height={72} className="print:h-14 print:w-14" />
            ) : null}
            <div>
              {profile.bankAccountName ? <p><span className="font-medium">A/C Name:</span> {profile.bankAccountName}</p> : null}
              {profile.bankAccountNumber ? <p><span className="font-medium">A/C No:</span> {profile.bankAccountNumber}</p> : null}
            </div>
          </div>
          <div className="text-right">
            {profile.bankIfsc ? <p><span className="font-medium">IFSC:</span> {profile.bankIfsc}</p> : null}
            {profile.bankName ? <p><span className="font-medium">Bank:</span> {profile.bankName}</p> : null}
            {profile.upiId ? <p><span className="font-medium">UPI:</span> {profile.upiId}</p> : null}
          </div>
        </div>
      ) : null}

      {profile?.footerNote ? (
        <p className="mt-2 border-t border-slate-200 pt-1.5 text-[10px] text-slate-600 print:mt-1 print:pt-1 print:text-[9px]">
          {profile.footerNote}
        </p>
      ) : null}
    </article>
  );
}
