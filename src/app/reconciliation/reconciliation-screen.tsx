"use client";

import { useState } from "react";
import { BulkStockEntryDialog } from "@/app/reconciliation/bulk-stock-entry-dialog";
import { CashSalePaymentDialog } from "@/app/reconciliation/cash-sale-payment-dialog";
import { StockEntryDialog } from "@/app/reconciliation/stock-entry-dialog";
import { SecondaryButton } from "@/components/admin/buttons";
import { EmptyState } from "@/components/admin/empty-state";
import { StatusBadge } from "@/components/admin/status-badge";
import type { ReconciliationCycle, ReconciliationPayload } from "@/lib/reconciliation";

function formatDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMoney(value: string) {
  const amount = Number(value);
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function VehicleCycleCard({
  cycle,
  onEditStock,
  onBulkEntry,
  onRecordPayment,
}: {
  cycle: ReconciliationCycle;
  onEditStock: () => void;
  onBulkEntry: () => void;
  onRecordPayment: () => void;
}) {
  const cashSaleAmount = Number(cycle.cashSaleAmount);
  const balance = Number(cycle.balance);
  const isReady = cycle.hasEveningEntry && cycle.hasMorningEntry && cycle.hasStockEntry;

  return (
    <section className="rounded-xl border border-surface-border bg-surface p-5 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            {cycle.vehicleCode} - {cycle.vehicleName}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            Evening {formatDate(cycle.eveningDate)} ({cycle.eveningRouteName ?? "no evening route"}) → Morning{" "}
            {formatDate(cycle.cycleDate)} ({cycle.morningRouteName ?? "no morning route"})
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge tone={cycle.hasEveningEntry ? "success" : "warning"}>
              {cycle.hasEveningEntry ? "Evening entry recorded" : "Evening entry pending"}
            </StatusBadge>
            <StatusBadge tone={cycle.hasMorningEntry ? "success" : "warning"}>
              {cycle.hasMorningEntry ? "Morning entry recorded" : "Morning entry pending"}
            </StatusBadge>
            <StatusBadge tone={cycle.hasStockEntry ? "success" : "warning"}>
              {cycle.hasStockEntry ? "Stock recorded" : "Stock not entered"}
            </StatusBadge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton type="button" onClick={onEditStock} className="h-9 px-4 text-sm font-medium">
            Edit stock
          </SecondaryButton>
          <SecondaryButton type="button" onClick={onBulkEntry} className="h-9 px-4 text-sm font-medium">
            Catch-up entry
          </SecondaryButton>
          <SecondaryButton type="button" onClick={onRecordPayment} className="h-9 px-4 text-sm font-medium">
            Record payment
          </SecondaryButton>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="px-3 py-2 text-left">Product</th>
              <th className="px-3 py-2 text-right">Given</th>
              <th className="px-3 py-2 text-right">Evening delivered</th>
              <th className="px-3 py-2 text-right">Morning delivered</th>
              <th className="px-3 py-2 text-right">Returned</th>
              <th className="px-3 py-2 text-right">Leftover</th>
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
                  <td className="px-3 py-2 text-right text-text-primary">{product.given}</td>
                  <td className="px-3 py-2 text-right text-text-primary">{product.eveningDelivered}</td>
                  <td className="px-3 py-2 text-right text-text-primary">{product.morningDelivered}</td>
                  <td className="px-3 py-2 text-right text-text-primary">{product.returned}</td>
                  <td
                    className={`px-3 py-2 text-right font-semibold ${leftover < 0 ? "text-rose-600" : "text-text-primary"}`}
                  >
                    {product.leftover}
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
        {!isReady ? (
          <StatusBadge tone="warning">Incomplete — some entries are still pending</StatusBadge>
        ) : null}
      </div>
    </section>
  );
}

export function ReconciliationScreen({ payload }: { payload: ReconciliationPayload }) {
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
    <div className="space-y-5">
      {payload.cycles.map((cycle) => (
        <VehicleCycleCard
          key={cycle.vehicleId}
          cycle={cycle}
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
