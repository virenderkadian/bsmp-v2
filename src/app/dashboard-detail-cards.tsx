"use client";

import { useState } from "react";
import { formatMoney, SummaryCard, type SummaryCardProps } from "@/app/summary-card";
import { Dialog } from "@/components/admin/dialog";
import { useLoadingBar } from "@/components/admin/loading-bar";
import type { ProductBreakdownRow, VehicleBalanceRow } from "@/lib/dashboard";
import { isUnsettled } from "@/lib/vehicle-balance";
import { cn } from "@/lib/utils";

type CardFace = Omit<SummaryCardProps, "onClick" | "hint">;

function formatQuantity(value: string) {
  const qty = Number(value);
  return qty.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function ProductBreakdown({ rows, emptyMessage }: { rows: ProductBreakdownRow[]; emptyMessage: string }) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-text-secondary">{emptyMessage}</p>;
  }
  const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-surface-border text-left text-xs text-text-secondary">
          <th className="py-2 pr-3 font-medium">Product</th>
          <th className="py-2 pr-3 text-right font-medium">Quantity</th>
          <th className="py-2 text-right font-medium">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.productId} className="border-b border-surface-border last:border-0">
            <td className="py-2 pr-3 font-medium text-text-primary">{row.name}</td>
            <td className="py-2 pr-3 text-right tabular-nums text-text-primary">
              {formatQuantity(row.quantity)} {row.unit}
            </td>
            <td className="py-2 text-right tabular-nums text-text-primary">{formatMoney(row.amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-surface-border-strong">
          <td className="py-2 pr-3 font-semibold text-text-primary" colSpan={2}>
            Total
          </td>
          <td className="py-2 text-right font-semibold tabular-nums text-text-primary">{formatMoney(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function ProductCard({
  face,
  title,
  description,
  rows,
  emptyMessage,
}: {
  face: CardFace;
  title: string;
  description: string;
  rows: ProductBreakdownRow[];
  emptyMessage: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SummaryCard {...face} onClick={() => setOpen(true)} hint="Click for the product-wise split" />
      <Dialog open={open} title={title} description={description} onClose={() => setOpen(false)}>
        <ProductBreakdown rows={rows} emptyMessage={emptyMessage} />
      </Dialog>
    </>
  );
}

export function DeliveredCard({ face, date, rows }: { face: CardFace; date: string; rows: ProductBreakdownRow[] }) {
  return (
    <ProductCard
      face={face}
      title="Delivered"
      description={`Quantity delivered per product on ${date}, at the rates used on each delivery.`}
      rows={rows}
      emptyMessage="Nothing was delivered on this date."
    />
  );
}

export function CashSaleCard({ face, date, rows }: { face: CardFace; date: string; rows: ProductBreakdownRow[] }) {
  return (
    <ProductCard
      face={face}
      title="Cash sale"
      description={`Leftover milk sold for cash per product, across all vehicles, for the cycle of ${date}.`}
      rows={rows}
      emptyMessage="No leftover was recorded for this date."
    />
  );
}

// Opens the Payments screen already filtered to verified payments on this date, rather than
// duplicating that list here.
export function CollectedCard({ face, date }: { face: CardFace; date: string }) {
  const { navigate } = useLoadingBar();
  return (
    <SummaryCard
      {...face}
      onClick={() => navigate(`/payments?status=VERIFIED&dateFrom=${date}&dateTo=${date}`)}
      hint="Open these payments"
    />
  );
}

export function UnsettledVehiclesCard({ face, date, rows }: { face: CardFace; date: string; rows: VehicleBalanceRow[] }) {
  const [open, setOpen] = useState(false);
  const sorted = [...rows].sort((a, b) => Math.abs(Number(b.balance)) - Math.abs(Number(a.balance)));
  const unsettled = sorted.filter(isUnsettled);
  return (
    <>
      <SummaryCard {...face} onClick={() => setOpen(true)} hint="Click for each vehicle's cash position" />
      <Dialog
        open={open}
        title="Vehicle cash position"
        description={`Cash sale less payments received for each vehicle's cycle of ${date}. A positive balance is cash not yet handed in.`}
        onClose={() => setOpen(false)}
      >
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-secondary">No vehicles to show.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs text-text-secondary">
                <th className="py-2 pr-3 font-medium">Vehicle</th>
                <th className="py-2 pr-3 text-right font-medium">Cash sale</th>
                <th className="py-2 pr-3 text-right font-medium">Received</th>
                <th className="py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.vehicleId} className="border-b border-surface-border last:border-0">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-text-primary">{row.vehicleName}</div>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-text-primary">{formatMoney(row.cashSale)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-text-primary">{formatMoney(row.received)}</td>
                  <td
                    className={cn(
                      "py-2 text-right font-medium tabular-nums",
                      isUnsettled(row) ? "text-status-warning-text" : "text-text-secondary",
                    )}
                  >
                    {formatMoney(row.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-surface-border-strong">
                <td className="py-2 pr-3 font-semibold text-text-primary">Total</td>
                <td className="py-2 pr-3 text-right font-semibold tabular-nums text-text-primary">
                  {formatMoney(rows.reduce((sum, row) => sum + Number(row.cashSale), 0))}
                </td>
                <td className="py-2 pr-3 text-right font-semibold tabular-nums text-text-primary">
                  {formatMoney(rows.reduce((sum, row) => sum + Number(row.received), 0))}
                </td>
                <td className="py-2 text-right font-semibold tabular-nums text-text-primary">
                  {formatMoney(unsettled.reduce((sum, row) => sum + Number(row.balance), 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </Dialog>
    </>
  );
}
