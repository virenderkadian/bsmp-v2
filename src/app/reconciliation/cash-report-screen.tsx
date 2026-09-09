"use client";

import { useActionState, useEffect, useState } from "react";
import {
  cancelCashSalePayment,
  recordCashSalePayment,
  updateCashSalePayment,
} from "@/app/reconciliation/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { Dialog } from "@/components/admin/dialog";
import { EmptyState } from "@/components/admin/empty-state";
import { useLoadingBar } from "@/components/admin/loading-bar";
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

const modeLabels: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
};

function modeLabel(mode: string) {
  return modeLabels[mode] ?? mode;
}

function statusLabel(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function statusTone(status: string) {
  if (status === "VERIFIED") {
    return "success" as const;
  }

  return status === "CANCELLED" ? ("danger" as const) : ("warning" as const);
}

const initialState = { status: "idle" as const };

// What a vehicle sold for cash over a range, and what its driver still owes.
//
// Read-only for everything derived — stock and deliveries are entered on the
// per-cycle screen and in Daily Entry. The single action here is recording
// money handed in, which is what makes "owes" fall.
export function CashReportScreen({ payload }: { payload: CashReportPayload }) {
  const [depositDate, setDepositDate] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(recordCashSalePayment, initialState);
  const [editState, editAction, editPending] = useActionState(updateCashSalePayment, initialState);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelCashSalePayment, initialState);
  const { navigate, setBusy } = useLoadingBar();
  const busy = pending || editPending || cancelPending;

  // A save is a wait too, so the bar covers it as well as navigation. The
  // button keeps its own spinner: the bar says the page is working, the
  // spinner says this click registered.
  useEffect(() => {
    setBusy(busy);
  }, [busy, setBusy]);

  // Close whichever dialog just succeeded. Keyed on the message so a second
  // save of the same kind is handled again rather than swallowed.
  const successKey = [state, editState, cancelState]
    .map((entry) => (entry.status === "success" ? entry.message : ""))
    .join("|");
  const [handledSuccessKey, setHandledSuccessKey] = useState(successKey);

  if (successKey !== handledSuccessKey) {
    setHandledSuccessKey(successKey);
    setDepositDate(null);
    setEditingId(null);
    setCancellingId(null);
  }

  if (!payload.dbConnected) {
    return <EmptyState message={payload.error ?? "Unable to load the cash report."} />;
  }

  if (payload.vehicles.length === 0) {
    return <EmptyState message="No active vehicle in this city." />;
  }

  const productName = (id: string) =>
    payload.products.find((product) => product.id === id)?.name ?? id;
  const owed = Number(payload.totals.owed);
  const editing = payload.deposits.find((deposit) => deposit.id === editingId);
  const cancelling = payload.deposits.find((deposit) => deposit.id === cancellingId);
  const successMessage = [state, editState, cancelState].find(
    (entry) => entry.status === "success" && entry.message,
  )?.message;

  return (
    <div className="space-y-5">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          // Client-side so the loading bar can show — this query scans a month
          // of deliveries and is the slowest wait on the screen. A native form
          // post would unload the document and take the bar with it.
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const params = new URLSearchParams({
            tab: "cash-report",
            vehicleId: String(data.get("vehicleId") ?? ""),
            from: String(data.get("from") ?? ""),
            to: String(data.get("to") ?? ""),
          });
          navigate(`/reconciliation?${params.toString()}`);
        }}
      >
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

      {/* Every deposit in the range, so a wrong figure can be found and put
          right. Cancelled rows stay visible: the trail should show that money
          was recorded and then withdrawn, not that it never existed. */}
      <section className="overflow-hidden rounded-xl border border-surface-border bg-surface shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-surface-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Deposits</h2>
          <SecondaryButton
            type="button"
            onClick={() => setDepositDate(payload.to)}
            className="h-9 px-3 text-sm font-medium"
          >
            Record a deposit
          </SecondaryButton>
        </div>
        {payload.deposits.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-secondary">
            No deposit recorded in this range.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-muted text-xs uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Collected on</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Mode</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Reference</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {payload.deposits.map((deposit) => (
                  <tr key={deposit.id} className={cn(deposit.status === "CANCELLED" && "opacity-60")}>
                    <td className="px-4 py-2 font-medium text-text-primary">{deposit.cycleDate}</td>
                    <td
                      className={cn(
                        "px-4 py-2 text-right tabular-nums",
                        deposit.status === "CANCELLED" ? "line-through" : "font-semibold",
                      )}
                    >
                      {money(deposit.amount)}
                    </td>
                    <td className="px-4 py-2 text-text-secondary">{modeLabel(deposit.mode)}</td>
                    <td className="px-4 py-2 text-text-secondary">{deposit.referenceNo || "—"}</td>
                    <td className="px-4 py-2">
                      <StatusBadge tone={statusTone(deposit.status)}>
                        {statusLabel(deposit.status)}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => setEditingId(deposit.id)}
                          className="text-xs font-semibold text-accent underline underline-offset-2"
                        >
                          Edit
                        </button>
                        {deposit.status === "CANCELLED" ? null : (
                          <button
                            type="button"
                            onClick={() => setCancellingId(deposit.id)}
                            className="text-xs font-semibold text-rose-700 underline underline-offset-2"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
            <PrimaryButton type="submit" disabled={busy}>
              {pending ? "Saving..." : "Record deposit"}
            </PrimaryButton>
          </div>
        </KeyboardForm>
      </Dialog>

      <Dialog
        open={editing !== undefined}
        onClose={() => setEditingId(null)}
        title="Edit deposit"
        description="Correcting what was recorded. The change is kept in the activity trail with the old figure alongside the new one."
        footer={null}
      >
        {editing ? (
          <KeyboardForm action={editAction} className="space-y-4" key={editing.id}>
            <input type="hidden" name="id" value={editing.id} readOnly />
            <div className="grid gap-4 md:grid-cols-2">
              <FormInput
                label="Amount"
                name="amount"
                type="number"
                step="0.01"
                defaultValue={editing.amount}
                autoFocus
              />
              <FormInput
                label="Collected on"
                name="paymentDate"
                type="date"
                defaultValue={editing.paymentDate}
              />
              <SelectInput
                label="Mode"
                name="mode"
                defaultValue={editing.mode}
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
                defaultValue={editing.status}
                options={[
                  { value: "VERIFIED", label: "Verified" },
                  { value: "PENDING", label: "Pending" },
                  { value: "CANCELLED", label: "Cancelled" },
                ]}
                className="h-10 rounded-md bg-surface text-sm"
              />
              <FormInput
                label="Reference"
                name="referenceNo"
                defaultValue={editing.referenceNo}
                placeholder="Optional"
              />
            </div>
            <p className="text-xs text-text-secondary">
              Recorded against {editing.cycleDate}. Only verified deposits reduce what the driver
              owes.
            </p>
            {editState.status === "error" && editState.message ? (
              <p className="text-sm text-rose-700">{editState.message}</p>
            ) : null}
            <div className="flex justify-end gap-3 border-t border-surface-border pt-4">
              <SecondaryButton type="button" onClick={() => setEditingId(null)}>
                Cancel
              </SecondaryButton>
              <PrimaryButton type="submit" disabled={busy}>
                {editPending ? "Saving..." : "Save changes"}
              </PrimaryButton>
            </div>
          </KeyboardForm>
        ) : null}
      </Dialog>

      <Dialog
        open={cancelling !== undefined}
        onClose={() => setCancellingId(null)}
        title="Cancel this deposit?"
        description="The row stays on record marked cancelled, and stops counting towards what has been deposited."
        footer={null}
      >
        {cancelling ? (
          <form action={cancelAction} className="space-y-4">
            <input type="hidden" name="id" value={cancelling.id} readOnly />
            <p className="text-sm text-text-primary">
              {money(cancelling.amount)} recorded against {cancelling.cycleDate}
              {cancelling.referenceNo ? ` (${cancelling.referenceNo})` : ""}.
            </p>
            <p className="text-sm text-text-secondary">
              What the driver owes will go up by this amount.
            </p>
            {cancelState.status === "error" && cancelState.message ? (
              <p className="text-sm text-rose-700">{cancelState.message}</p>
            ) : null}
            <div className="flex justify-end gap-3 border-t border-surface-border pt-4">
              <SecondaryButton type="button" onClick={() => setCancellingId(null)}>
                Keep it
              </SecondaryButton>
              <PrimaryButton type="submit" disabled={busy}>
                {cancelPending ? "Cancelling..." : "Cancel deposit"}
              </PrimaryButton>
            </div>
          </form>
        ) : null}
      </Dialog>

      {successMessage ? <Toast tone="success">{successMessage}</Toast> : null}
    </div>
  );
}
