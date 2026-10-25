"use client";

import { useState } from "react";
import { BulkStockEntryDialog } from "@/app/reconciliation/bulk-stock-entry-dialog";
import { CashSalePaymentDialog } from "@/app/reconciliation/cash-sale-payment-dialog";
import { StockEntryDialog } from "@/app/reconciliation/stock-entry-dialog";
import { IconButton } from "@/components/admin/icon-button";
import { EmptyState } from "@/components/admin/empty-state";
import { PencilSquareIcon, SyncIcon, WalletIcon, WhatsAppIcon } from "@/components/admin/icons";
import { StatusBadge } from "@/components/admin/status-badge";
import type { ReconciliationCycle, ReconciliationPayload } from "@/lib/reconciliation";
import { formatMoney, formatQty } from "@/lib/reconciliation-format";
import { buildVehicleShareMessage, buildWhatsAppShareUrl } from "@/lib/reconciliation-share";

function formatDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// "a, b and c" rather than "a and b and c".
function formatList(items: string[]) {
  if (items.length <= 1) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// A shift can be covered by more than one route — a vehicle picking up
// another's customers while it is off the road. Names them all, marking any
// that has since been handed back so a figure it contributed doesn't look
// like it came from nowhere.
function formatRoutes(routes: ReconciliationCycle["eveningRoutes"], emptyLabel: string) {
  if (routes.length === 0) {
    return emptyLabel;
  }
  return formatList(routes.map((route) => (route.reassignedAway ? `${route.name} (reassigned)` : route.name)));
}

// Shown only when a shift's figure is the sum of more than one route, so the
// office can check the split against what they expect. A single route adds
// nothing but noise — the column above already says it.
// A shift's delivered figure, with the per-route split behind a hover when
// more than one route went into it. Printed inline it was noise on every row
// of every vehicle; the split only matters when someone is checking a total
// that came from two rounds. A native title rather than a positioned tooltip
// because the table sits in an overflow-x-auto container, which would clip
// one. The dotted underline is what says there is something to hover.
function Delivered({
  quantity,
  splits,
}: {
  quantity: string;
  splits: ReconciliationCycle["products"][number]["eveningByRoute"];
}) {
  if (splits.length < 2) {
    return <>{formatQty(quantity)}</>;
  }

  return (
    <span
      title={splits.map((split) => `${split.routeName} ${formatQty(split.quantity)}`).join(" · ")}
      className="cursor-help underline decoration-dotted underline-offset-4"
    >
      {formatQty(quantity)}
    </span>
  );
}

// Delivered + Leftover: everything that left the vehicle and has to be
// accounted for. Equal to Given − Returned by definition, so it also works
// as a check that the row balances. Purely a display figure — nothing here
// changes what's stored or how the cash figures above it are computed.
function totalOf(product: ReconciliationCycle["products"][number]) {
  return Number(product.eveningDelivered) + Number(product.morningDelivered) + Number(product.leftover);
}

function VehicleCycleSection({
  cycle,
  shareTemplate,
  onEditStock,
  onBulkEntry,
  onRecordPayment,
}: {
  cycle: ReconciliationCycle;
  shareTemplate: string;
  onEditStock: () => void;
  onBulkEntry: () => void;
  onRecordPayment: () => void;
}) {
  const cashSaleAmount = Number(cycle.cashSaleAmount);
  const balance = Number(cycle.balance);
  const isReady = cycle.hasEveningEntry && cycle.hasMorningEntry && cycle.hasStockEntry;

  // What is still missing, said once. Three separate badges on every vehicle
  // was three things to read per row when the useful answer is usually "ready"
  // or one specific gap.
  const pending = [
    cycle.hasEveningEntry ? null : "evening entry",
    cycle.hasMorningEntry ? null : "morning entry",
    cycle.hasStockEntry ? null : "stock",
  ].filter((item): item is string => item !== null);

  const shareUrl = buildWhatsAppShareUrl(buildVehicleShareMessage(cycle, shareTemplate));

  return (
    // A section and a rule rather than a card. Border, radius and shadow each
    // say "separate object", and stamping them on all eight vehicles made the
    // frame mean nothing while burying the one round that needs attention.
    <section className="border-t border-surface-border py-5 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-text-primary">
            {cycle.vehicleCode} · {cycle.vehicleName}
          </h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            {formatRoutes(cycle.eveningRoutes, "no evening route")} {formatDate(cycle.eveningDate)} →{" "}
            {formatRoutes(cycle.morningRoutes, "no morning route")} {formatDate(cycle.cycleDate)}
          </p>
          <div className="mt-2">
            {isReady ? (
              <StatusBadge tone="success">Ready</StatusBadge>
            ) : (
              <StatusBadge tone="warning">Waiting on {formatList(pending)}</StatusBadge>
            )}
          </div>
        </div>
        {/* Icon-only, using the app's own icons — the pencil already means
            edit on Customers and Vehicles, the wallet is the Payments sidebar
            icon, so this row looks like the rest of the app rather than
            inventing new symbols. Each carries a title + aria-label, which is
            both the hover label and the accessible name. */}
        <div className="flex flex-wrap gap-1.5">
          <IconButton
            type="button"
            onClick={onEditStock}
            title="Edit stock"
            aria-label="Edit stock"
            className="border border-surface-border-strong bg-surface text-text-primary shadow-sm hover:border-accent hover:bg-surface-muted"
          >
            <PencilSquareIcon className="h-[18px] w-[18px]" />
          </IconButton>
          <IconButton
            type="button"
            onClick={onBulkEntry}
            title="Catch-up entry"
            aria-label="Catch-up entry"
            className="border border-surface-border-strong bg-surface text-text-primary shadow-sm hover:border-accent hover:bg-surface-muted"
          >
            <SyncIcon className="h-[18px] w-[18px]" />
          </IconButton>
          <IconButton
            type="button"
            onClick={onRecordPayment}
            title="Record payment"
            aria-label="Record payment"
            className="border border-surface-border-strong bg-surface text-text-primary shadow-sm hover:border-accent hover:bg-surface-muted"
          >
            <WalletIcon className="h-[18px] w-[18px]" />
          </IconButton>
          <a
            href={shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Share this vehicle on WhatsApp"
            aria-label="Share this vehicle on WhatsApp"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#25d366] text-[#06351a] transition hover:brightness-95"
          >
            <WhatsAppIcon className="h-4 w-4" />
          </a>
        </div>
      </div>

      {!cycle.hasStockEntry ? (
        <p className="mt-3 text-sm text-text-secondary">Stock not entered yet.</p>
      ) : (
        <>
          <div className="mt-4 hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-right">Given</th>
                  <th className="px-3 py-2 text-right">Evening delivered</th>
                  <th className="px-3 py-2 text-right">Morning delivered</th>
                  <th className="px-3 py-2 text-right">Returned</th>
                  <th className="px-3 py-2 text-right">Leftover</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cycle.products.map((product) => {
                  const leftover = Number(product.leftover);
                  return (
                    <tr key={product.productId}>
                      <td className="px-3 py-2 font-medium text-text-primary">
                        {product.productName} <span className="text-text-muted">({product.unit})</span>
                      </td>
                      <td className="px-3 py-2 text-right text-text-primary">{formatQty(product.given)}</td>
                      <td className="px-3 py-2 text-right text-text-primary">
                        <Delivered quantity={product.eveningDelivered} splits={product.eveningByRoute} />
                      </td>
                      <td className="px-3 py-2 text-right text-text-primary">
                        <Delivered quantity={product.morningDelivered} splits={product.morningByRoute} />
                      </td>
                      <td className="px-3 py-2 text-right text-text-primary">{formatQty(product.returned)}</td>
                      <td
                        className={`px-3 py-2 text-right font-semibold ${leftover < 0 ? "text-rose-600" : "text-text-primary"}`}
                      >
                        {formatQty(product.leftover)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-text-primary">
                        {formatQty(totalOf(product))}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold ${leftover < 0 ? "text-rose-600" : "text-text-primary"}`}
                      >
                        {formatMoney(product.leftoverValue)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* An eight-column table can't survive a phone — each product
              becomes its own block, with Total on a full-width row of its own
              rather than orphaned inside a two-column grid. */}
          <div className="mt-4 space-y-3 sm:hidden">
            {cycle.products.map((product) => {
              const leftover = Number(product.leftover);
              const delivered = Number(product.eveningDelivered) + Number(product.morningDelivered);
              return (
                <div key={product.productId} className="rounded-lg border border-surface-border px-3 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-text-primary">
                      {product.productName} <span className="text-text-muted">({product.unit})</span>
                    </span>
                    <span
                      className={`text-sm font-semibold ${leftover < 0 ? "text-rose-600" : "text-text-primary"}`}
                    >
                      {formatMoney(product.leftoverValue)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="text-text-secondary">Given</span>
                      <span className="font-medium text-text-primary">{formatQty(product.given)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-text-secondary">Returned</span>
                      <span className="font-medium text-text-primary">{formatQty(product.returned)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-text-secondary">Delivered</span>
                      <span className="font-medium text-text-primary">{formatQty(delivered)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-text-secondary">Leftover</span>
                      <span className={`font-semibold ${leftover < 0 ? "text-rose-600" : "text-text-primary"}`}>
                        {formatQty(product.leftover)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between border-t border-surface-border pt-1.5 text-xs">
                    <span className="font-semibold text-text-secondary">Total accounted</span>
                    <span className="text-sm font-semibold text-text-primary">{formatQty(totalOf(product))}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-muted px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                {cashSaleAmount < 0 ? "Difference (shortage)" : "Cash sale"}
              </p>
              <p className={`text-lg font-bold ${cashSaleAmount < 0 ? "text-rose-600" : "text-text-primary"}`}>
                {formatMoney(cycle.cashSaleAmount)}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Payments received</p>
              <p className="text-lg font-bold text-emerald-700">{formatMoney(cycle.paymentsReceived)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Balance</p>
              <p className={`text-lg font-bold ${balance > 0 ? "text-amber-600" : "text-text-primary"}`}>
                {formatMoney(cycle.balance)}
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function ReconciliationScreen({
  payload,
  shareTemplate,
}: {
  payload: ReconciliationPayload;
  shareTemplate: string;
}) {
  const [stockDialogVehicleId, setStockDialogVehicleId] = useState<string | null>(null);
  const [bulkDialogVehicleId, setBulkDialogVehicleId] = useState<string | null>(null);
  const [paymentDialogVehicleId, setPaymentDialogVehicleId] = useState<string | null>(null);

  const stockDialogCycle = payload.cycles.find((cycle) => cycle.vehicleId === stockDialogVehicleId);
  const bulkDialogVehicle = payload.vehicles.find((vehicle) => vehicle.id === bulkDialogVehicleId);
  const paymentDialogCycle = payload.cycles.find((cycle) => cycle.vehicleId === paymentDialogVehicleId);

  if (payload.reconciliationProducts.length === 0) {
    return (
      <EmptyState message="No products are marked for reconciliation. Go to Products & Rates and mark the milk products (e.g. Buffalo Milk, Cow Milk, Lassi) as included in reconciliation." />
    );
  }

  if (payload.vehicles.length === 0) {
    return <EmptyState message="No active vehicles. Add a vehicle in Routes to start reconciliation." />;
  }

  return (
    <div>
      {payload.cycles.map((cycle) => (
        <VehicleCycleSection
          key={cycle.vehicleId}
          cycle={cycle}
          shareTemplate={shareTemplate}
          onEditStock={() => setStockDialogVehicleId(cycle.vehicleId)}
          onBulkEntry={() => setBulkDialogVehicleId(cycle.vehicleId)}
          onRecordPayment={() => setPaymentDialogVehicleId(cycle.vehicleId)}
        />
      ))}

      {stockDialogCycle ? (
        <StockEntryDialog
          open
          dbConnected={payload.dbConnected}
          cycle={stockDialogCycle}
          reconciliationProducts={payload.reconciliationProducts}
          onClose={() => setStockDialogVehicleId(null)}
        />
      ) : null}

      {bulkDialogVehicle ? (
        <BulkStockEntryDialog
          open
          dbConnected={payload.dbConnected}
          vehicleId={bulkDialogVehicle.id}
          vehicleName={`${bulkDialogVehicle.code} - ${bulkDialogVehicle.name}`}
          reconciliationProducts={payload.reconciliationProducts}
          onClose={() => setBulkDialogVehicleId(null)}
        />
      ) : null}

      {paymentDialogCycle ? (
        <CashSalePaymentDialog
          open
          dbConnected={payload.dbConnected}
          cycle={paymentDialogCycle}
          onClose={() => setPaymentDialogVehicleId(null)}
        />
      ) : null}
    </div>
  );
}
