import { Fragment } from "react";
import type { MonthlyBillDetail } from "@/lib/monthly-bills";

// The one-page format.
//
// Two decisions buy back roughly half an A4 page against the classic layout:
// the month is split into two halves side by side, and the per-day Amt column
// is dropped for any product whose rate never moved — the rate is already in
// the column heading and the money is already in the Total row, so a daily
// amount there repeats arithmetic rather than adding anything.
//
// That space is spent on the two things a bill actually exists to do: say who
// this is and what they owe, and say how to pay. Hence a real letterhead, a
// band carrying the round and stop number so a query reaches the right driver,
// and a payment block with a QR large enough to scan from a doorstep.

function formatMoney(value: string | number) {
  return `₹${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatRate(value: string) {
  const rate = Number(value);
  return rate % 1 === 0 ? `₹${rate}` : `₹${rate.toFixed(2)}`;
}

function formatQuantity(value: string) {
  const quantity = Number(value);
  return quantity === 0 ? "" : quantity.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function formatMonthTitle(value: Date) {
  return new Date(value)
    .toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    .toUpperCase();
}

// Every distinct rate this product was actually delivered at this month. One
// entry means the rate held all month and the daily Amt column can go; more
// than one means the daily figures carry real information and it stays.
function ratesFor(bill: MonthlyBillDetail, productId: string): string[] {
  const rates = new Set<string>();

  for (const day of bill.calendarDays) {
    const cell = day.products[productId];

    if (cell && Number(cell.quantity) > 0) {
      rates.add(Number(cell.rate).toFixed(2));
    }
  }

  return [...rates];
}

function CalendarHalf({
  bill,
  from,
  to,
  showAmt,
  withTotals,
}: {
  bill: MonthlyBillDetail;
  from: number;
  to: number;
  showAmt: Set<string>;
  withTotals: boolean;
}) {
  const days = bill.calendarDays.filter((day) => day.day >= from && day.day <= to);

  return (
    <table className="w-full border-collapse text-[8.5px] print:text-[8px]">
      <thead>
        <tr className="bg-slate-100">
          <th className="border border-slate-300 px-1 py-0.5 text-left">Dt</th>
          {bill.calendarProducts.map((product) => {
            const rates = ratesFor(bill, product.id);

            return (
              <th
                key={product.id}
                colSpan={showAmt.has(product.id) ? 2 : 1}
                className="border border-slate-300 px-1 py-0.5"
              >
                {product.shortName ?? product.name}
                {rates.length === 1 ? (
                  <span className="font-normal text-slate-600"> {formatRate(rates[0])}</span>
                ) : null}
              </th>
            );
          })}
          <th className="border border-slate-300 px-1 py-0.5">Amt</th>
        </tr>
      </thead>
      <tbody>
        {days.map((day) => (
          <tr key={day.day} className={!day.hasEntry || day.skipped ? "text-slate-400" : undefined}>
            <td className="border border-slate-300 px-1 py-0.5">{day.day}</td>
            {bill.calendarProducts.map((product) => {
              const cell = day.products[product.id];
              const has = Number(cell?.quantity ?? 0) > 0;

              return showAmt.has(product.id) ? (
                <Fragment key={product.id}>
                  <td className="border border-slate-300 px-1 py-0.5 text-right">
                    {has ? formatQuantity(cell.quantity) : ""}
                  </td>
                  <td className="border border-slate-300 px-1 py-0.5 text-right">
                    {has ? formatMoney(cell.amount) : ""}
                  </td>
                </Fragment>
              ) : (
                <td key={product.id} className="border border-slate-300 px-1 py-0.5 text-right">
                  {has ? formatQuantity(cell.quantity) : ""}
                </td>
              );
            })}
            <td className="border border-slate-300 px-1 py-0.5 text-right">
              {Number(day.grossAmount) > 0 ? formatMoney(day.grossAmount) : ""}
            </td>
          </tr>
        ))}
        {withTotals ? (
          <tr className="bg-slate-100 font-semibold">
            <td className="border border-slate-300 px-1 py-0.5">Tot</td>
            {bill.calendarProducts.map((product) => {
              const totals = bill.calendarTotals.products[product.id];

              return showAmt.has(product.id) ? (
                <Fragment key={product.id}>
                  <td className="border border-slate-300 px-1 py-0.5 text-right">
                    {formatQuantity(totals?.quantity ?? "0")}
                  </td>
                  <td className="border border-slate-300 px-1 py-0.5 text-right">
                    {formatMoney(totals?.amount ?? "0")}
                  </td>
                </Fragment>
              ) : (
                <td key={product.id} className="border border-slate-300 px-1 py-0.5 text-right">
                  {formatQuantity(totals?.quantity ?? "0")}
                </td>
              );
            })}
            <td className="border border-slate-300 px-1 py-0.5 text-right">
              {formatMoney(bill.calendarTotals.grossAmount)}
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="self-center text-[7.5px] uppercase tracking-[0.1em] text-slate-500">{label}</dt>
      <dd className="m-0 text-[9.5px] font-semibold">{value}</dd>
    </>
  );
}

export function CompactBillDocument({
  bill,
  qrDataUrl,
  className,
}: {
  bill: MonthlyBillDetail;
  qrDataUrl: string | null;
  className?: string;
}) {
  const profile = bill.businessProfile;
  // Kept only where the rate actually moved mid-month.
  const showAmt = new Set(
    bill.calendarProducts.filter((product) => ratesFor(bill, product.id).length > 1).map((p) => p.id),
  );
  // Split at 16 so the left half is never shorter than the right, whatever the
  // month's length.
  const half = 16;
  const milkTotal = Number(bill.deliveryAmount) - Number(bill.otherItemsTotal);
  const address = [profile?.addressLine1, profile?.addressLine2].filter(Boolean).join(", ");

  return (
    <article
      className={`bill-document flex flex-col rounded-lg border border-slate-300 bg-white p-4 text-[10px] text-slate-900 print:rounded-none print:border-0 print:p-0 ${className ?? ""}`}
    >
      <header className="flex items-start justify-between gap-4 border-b-2 border-slate-900 pb-2">
        <div>
          <h1 className="text-lg font-bold uppercase leading-tight tracking-tight">
            {profile?.businessName ?? "Business name not set"}
          </h1>
          <p className="mt-0.5 text-[9px] leading-snug text-slate-600">
            {address}
            {address && profile?.contactPhone ? <br /> : null}
            {profile?.contactPhone}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[7.5px] uppercase tracking-[0.14em] text-slate-500">
            Bill for the month of
          </p>
          <p className="text-sm font-bold leading-tight">{formatMonthTitle(bill.billingMonth)}</p>
        </div>
      </header>

      {/* Everything here is already in the database and was simply never
          printed. The stop number and driver are what let a customer raise a
          query with the right person instead of ringing the office blind. */}
      <div className="flex border border-t-0 border-slate-300">
        <div className="flex-1 px-2 py-1.5">
          <dl className="m-0 grid grid-cols-[52px_1fr] gap-x-2 gap-y-0.5">
            <dt className="self-center text-[7.5px] uppercase tracking-[0.1em] text-slate-500">
              Customer
            </dt>
            <dd className="m-0 text-[11.5px] font-bold leading-tight">{bill.customerName}</dd>
            <Field label="Code" value={bill.customerCode} />
            {bill.customerArea ? <Field label="Area" value={bill.customerArea} /> : null}
            {bill.customerMobile ? <Field label="Mobile" value={bill.customerMobile} /> : null}
          </dl>
        </div>
        <div className="flex-1 border-l border-slate-300 px-2 py-1.5">
          <dl className="m-0 grid grid-cols-[52px_1fr] gap-x-2 gap-y-0.5">
            <dt className="self-center text-[7.5px] uppercase tracking-[0.1em] text-slate-500">
              Route
            </dt>
            <dd className="m-0 text-[11.5px] font-bold leading-tight">
              {bill.routeCode} · {bill.routeName}
            </dd>
            <Field
              label="Round"
              value={bill.routeShift === "EVENING" ? "Evening" : "Morning"}
            />
            {bill.driverName ? (
              <Field
                label="Driver"
                value={[bill.driverName, bill.driverPhone].filter(Boolean).join(" · ")}
              />
            ) : null}
            <Field label="Stop no." value={String(bill.customerSequenceNo ?? "-")} />
          </dl>
        </div>
      </div>

      <div className="mt-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <CalendarHalf bill={bill} from={1} to={half} showAmt={showAmt} withTotals={false} />
        </div>
        <div className="min-w-0 flex-1">
          <CalendarHalf bill={bill} from={half + 1} to={31} showAmt={showAmt} withTotals />
        </div>
      </div>

      {/* Grows downward as items are added — several occasional sales simply
          take a second line rather than needing a table of their own. */}
      {bill.otherItems.length > 0 ? (
        <div className="mt-1.5 flex justify-between gap-3 border border-slate-300 bg-slate-50 px-2 py-1 text-[9.5px]">
          <p className="m-0">
            <span className="font-semibold">Other items: </span>
            {bill.otherItems
              .map(
                (item) =>
                  `${formatQuantity(item.quantity)} ${item.unit} ${item.shortName ?? item.name} × ${formatMoney(item.rate)}`,
              )
              .join("   ·   ")}
          </p>
          <p className="m-0 whitespace-nowrap font-semibold">{formatMoney(bill.otherItemsTotal)}</p>
        </div>
      ) : null}

      <div className="ml-auto mt-2 w-60 space-y-0.5">
        <div className="flex justify-between">
          <span>Previous Balance</span>
          <span>{formatMoney(bill.openingBalance)}</span>
        </div>
        <div className="flex justify-between">
          <span>Milk / Product Total (+)</span>
          <span>{formatMoney(milkTotal)}</span>
        </div>
        {Number(bill.otherItemsTotal) !== 0 ? (
          <div className="flex justify-between">
            <span>Other Items (+)</span>
            <span>{formatMoney(bill.otherItemsTotal)}</span>
          </div>
        ) : null}
        <div className="flex justify-between">
          <span>Payment Received (−)</span>
          <span>{formatMoney(bill.paymentAmount)}</span>
        </div>
        <div className="flex justify-between border-t-2 border-slate-900 pt-1 text-xs font-bold">
          <span>BALANCE AMOUNT</span>
          <span>{formatMoney(bill.closingBalance)}</span>
        </div>
      </div>

      {profile ? (
        <div className="mt-auto pt-2">
          <div className="flex items-stretch gap-3 border-[1.5px] border-slate-900 p-2">
            {qrDataUrl ? (
              <div className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- printed document, no optimization to do */}
                <img src={qrDataUrl} alt="UPI QR code" className="h-24 w-24 border-2 border-slate-900" />
                <p className="mt-0.5 text-center text-[7.5px] uppercase tracking-[0.08em] text-slate-600">
                  Scan to pay
                </p>
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="m-0 mb-1 text-[8px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                How to pay
              </p>
              <dl className="m-0 grid grid-cols-[70px_1fr] gap-x-2.5 gap-y-0.5">
                {profile.upiId ? (
                  <>
                    <dt className="text-[8px] uppercase tracking-wide text-slate-500">UPI ID</dt>
                    <dd className="m-0 font-mono text-[11px] font-semibold">{profile.upiId}</dd>
                  </>
                ) : null}
                {profile.bankName ? (
                  <>
                    <dt className="text-[8px] uppercase tracking-wide text-slate-500">Bank</dt>
                    <dd className="m-0 font-mono text-[9.5px] font-semibold">{profile.bankName}</dd>
                  </>
                ) : null}
                {profile.bankAccountName ? (
                  <>
                    <dt className="text-[8px] uppercase tracking-wide text-slate-500">A/C Name</dt>
                    <dd className="m-0 font-mono text-[9.5px] font-semibold">
                      {profile.bankAccountName}
                    </dd>
                  </>
                ) : null}
                {profile.bankAccountNumber ? (
                  <>
                    <dt className="text-[8px] uppercase tracking-wide text-slate-500">A/C No.</dt>
                    <dd className="m-0 font-mono text-[9.5px] font-semibold">
                      {profile.bankAccountNumber}
                    </dd>
                  </>
                ) : null}
                {profile.bankIfsc ? (
                  <>
                    <dt className="text-[8px] uppercase tracking-wide text-slate-500">IFSC</dt>
                    <dd className="m-0 font-mono text-[9.5px] font-semibold">{profile.bankIfsc}</dd>
                  </>
                ) : null}
              </dl>
            </div>
          </div>
          {profile.footerNote ? (
            <p className="mt-1.5 border-t border-dashed border-slate-400 pt-1 text-[9px] text-slate-700">
              {profile.footerNote}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
