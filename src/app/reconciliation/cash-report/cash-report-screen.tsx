"use client";

import { useActionState, useState } from "react";
import { recordCashSalePayment } from "@/app/reconciliation/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { Dialog } from "@/components/admin/dialog";
import { EmptyState } from "@/components/admin/empty-state";
import { FormInput } from "@/components/admin/form-input";
import { KeyboardForm } from "@/components/admin/keyboard-form";
import { SelectInput } from "@/components/admin/select-input";
import { StatusBadge } from "@/components/admin/status-badge";
import { Toast } from "@/components/admin/toast";
import type { CashReportPayload } from "@/lib/reconciliation";
import { cn } from "@/lib/utils";

function money(value: string) {
  return `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function qty(value: string) {
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

const initialState = { status: "idle" as const };

// What a vehicle sold for cash over a range, and what its driver still owes.
//
// Read-only for everything derived — stock and deliveries are entered on the
// per-cycle screen and in Daily Entry. The single action here is recording
// money handed in, which is what makes "owes" fall.
export function CashReportScreen({ payload }: { payload: CashReportPayload }) {
  const [depositDate, setDepositDate] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(recordCashSalePayment, initialState);

  if (!payload.dbConnected) {
    return <EmptyState message={payload.error ?? "Unable to load the cash report."} />;
  }

  if (payload.vehicles.length === 0) {
    return <EmptyState message="No active vehicle in this city." />;
  }

  const productName = (id: string) =>
    payload.products.find((product) => product.id === id)?.name ?? id;
  const owed = Number(payload.totals.owed);

  return (
    <div className="space-y-5">
      <form action="/reconciliation/cash-report" className="flex flex-wrap items-end gap-3">
        <SelectInput
          label="Vehicle"
          name="vehicleId"
          defaultValue={payload.selectedVehicleId}
          options={payload.vehicles.map((vehicle) => ({
            value: vehicle.id,
            label: `${vehicle.code} - ${vehicle.name}`,
          }))}
          className="h-10 w-64 rounded-md bg-surface text-sm"
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-secondary">From</span>
          <input
            type="date"
            name="from"
            defaultValue={payload.from}
            className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-secondary">To</span>
          <input
            type="date"
            name="to"
            defaultValue={payload.to}
            className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
          />
        </label>
        <PrimaryButton type="submit" className="h-10 rounded-md px-5 text-sm font-semibold">
          Load report
        </PrimaryButton>
      </form>

      {/* Says what the figures are built from. During migration a range can be
          only partly recorded, and a total that does not say so invites being
          read as complete. */}
      {payload.totals.daysMissingStock > 0 ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <strong className="font-semibold">
            {payload.totals.daysRecorded} of{" "}
            {payload.totals.daysRecorded + payload.totals.daysMissingStock} days have stock
            recorded.
          </strong>{" "}
          The rest are listed below with their deliveries, but cannot be priced — there is no
          loaded quantity to measure a cash sale against, so they stay out of the totals.
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        {payload.totals.products.map((product) => (
          <section key={product.productId} className="rounded-lg border border-surface-border bg-surface p-4">
            <h3 className="text-sm font-semibold text-text-primary">{productName(product.productId)}</h3>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-text-secondary">Taken</dt>
                <dd className="tabular-nums text-text-primary">{qty(product.taken)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-text-secondary">Distributed</dt>
                <dd className="tabular-nums text-text-primary">{qty(product.distributed)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-text-secondary">Returned</dt>
                <dd className="tabular-nums text-text-primary">{qty(product.returned)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-surface-border pt-1.5">
                <dt className="text-text-secondary">Cash milk</dt>
                <dd className="font-semibold tabular-nums text-text-primary">{qty(product.cashQty)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-text-secondary">Cash amount</dt>
                <dd className="font-semibold tabular-nums text-text-primary">{money(product.cashAmount)}</dd>
              </div>
            </dl>
          </section>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <section className="rounded-lg border border-surface-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-text-secondary">Total cash</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-text-primary">
            {money(payload.totals.totalCash)}
          </p>
        </section>
        <section className="rounded-lg border border-surface-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-text-secondary">Total deposited</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-status-success-text">
            {money(payload.totals.totalDeposited)}
          </p>
        </section>
        {/* The point of the page: what is still to be collected. */}
        <section className="rounded-lg border border-surface-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-text-secondary">Driver owes</p>
          <p
            className={cn(
              "mt-1 text-2xl font-bold tabular-nums",
              owed > 0 ? "text-rose-700" : "text-status-success-text",
            )}
          >
            {money(payload.totals.owed)}
          </p>
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-surface-border bg-surface shadow-sm">
        <h2 className="border-b border-surface-border px-4 py-3 text-sm font-semibold text-text-primary">
          Day by day
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-surface-muted text-xs uppercase tracking-wide text-text-secondary">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Date</th>
                <th className="px-4 py-2.5 text-left font-semibold">Product</th>
                <th className="px-4 py-2.5 text-right font-semibold">Taken</th>
                <th className="px-4 py-2.5 text-right font-semibold">Distributed</th>
                <th className="px-4 py-2.5 text-right font-semibold">Returned</th>
                <th className="px-4 py-2.5 text-right font-semibold">Cash milk</th>
                <th className="px-4 py-2.5 text-right font-semibold">Cash amt</th>
                <th className="px-4 py-2.5 text-right font-semibold">Deposited</th>
                <th className="px-4 py-2.5 text-right font-semibold">Pending</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {payload.days.map((day) =>
                day.stockRecorded ? (
                  day.products.map((product, index) => (
                    <tr key={day.date + product.productId}>
                      <td className="px-4 py-2 font-medium text-text-primary">
                        {index === 0 ? day.date : ""}
                      </td>
                      <td className="px-4 py-2 text-text-secondary">{productName(product.productId)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{qty(product.given)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{qty(product.delivered)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{qty(product.returned)}</td>
                      <td
                        className={cn(
                          "px-4 py-2 text-right tabular-nums",
                          Number(product.cashQty) < 0 ? "font-semibold text-amber-700" : "",
                        )}
                        title={
                          Number(product.cashQty) < 0
                            ? "More was delivered than loaded — worth checking the entry"
                            : undefined
                        }
                      >
                        {qty(product.cashQty)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(product.cashAmount)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-status-success-text">
                        {index === 0 && Number(day.deposited) > 0 ? money(day.deposited) : ""}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-rose-700">
                        {index === 0 ? money(day.pending) : ""}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr key={day.date} className="bg-surface-muted/40">
                    <td className="px-4 py-2 font-medium text-text-primary">{day.date}</td>
                    <td className="px-4 py-2" colSpan={6}>
                      <StatusBadge tone="warning">Stock not recorded</StatusBadge>{" "}
                      <span className="text-text-secondary">
                        {day.products.some((product) => Number(product.delivered) > 0)
                          ? "Deliveries happened but nothing was loaded on record, so this day cannot be priced."
                          : "No deliveries recorded either."}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-status-success-text">
                      {Number(day.deposited) > 0 ? money(day.deposited) : ""}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setDepositDate(day.date)}
                        className="text-xs font-semibold text-accent underline underline-offset-2"
                      >
                        Add deposit
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex justify-end">
        <SecondaryButton
          type="button"
          onClick={() => setDepositDate(payload.to)}
          className="h-10 px-4 text-sm font-medium"
        >
          Record a deposit
        </SecondaryButton>
      </div>

      <Dialog
        open={depositDate !== null}
        onClose={() => setDepositDate(null)}
        title="Record a deposit"
        description="Money handed in by the driver, recorded against the day it was collected."
        footer={null}
      >
        <KeyboardForm action={formAction} className="space-y-4">
          <input type="hidden" name="vehicleId" value={payload.selectedVehicleId} readOnly />
          <input type="hidden" name="cycleDate" value={depositDate ?? ""} readOnly />
          <input type="hidden" name="paymentDate" value={depositDate ?? ""} readOnly />
          <div className="grid gap-4 md:grid-cols-2">
            <FormInput label="Amount" name="amount" type="number" step="0.01" autoFocus placeholder="0.00" />
            <SelectInput
              label="Mode"
              name="mode"
              defaultValue="CASH"
              options={[
                { value: "CASH", label: "Cash" },
                { value: "UPI", label: "UPI" },
                { value: "BANK_TRANSFER", label: "Bank transfer" },
                { value: "CHEQUE", label: "Cheque" },
              ]}
              className="h-10 rounded-md bg-surface text-sm"
            />
            <SelectInput
              label="Status"
              name="status"
              defaultValue="VERIFIED"
              options={[
                { value: "VERIFIED", label: "Verified" },
                { value: "PENDING", label: "Pending" },
              ]}
              className="h-10 rounded-md bg-surface text-sm"
            />
            <FormInput label="Reference" name="referenceNo" placeholder="Optional" />
          </div>
          <p className="text-xs text-text-secondary">
            Collected on {depositDate}. Only verified deposits reduce what the driver owes.
          </p>
          {state.status === "error" && state.message ? (
            <p className="text-sm text-rose-700">{state.message}</p>
          ) : null}
          <div className="flex justify-end gap-3 border-t border-surface-border pt-4">
            <SecondaryButton type="button" onClick={() => setDepositDate(null)}>
              Cancel
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={pending}>
              {pending ? "Saving..." : "Record deposit"}
            </PrimaryButton>
          </div>
        </KeyboardForm>
      </Dialog>

      {state.status === "success" && state.message ? (
        <Toast tone="success">{state.message}</Toast>
      ) : null}
    </div>
  );
}
