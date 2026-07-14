"use client";

import { Fragment, useActionState, useEffect, useMemo, useState } from "react";
import { saveVehicleCycleStock, type ActionState } from "@/app/reconciliation/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { Dialog } from "@/components/admin/dialog";
import { FormInput } from "@/components/admin/form-input";
import { KeyboardForm } from "@/components/admin/keyboard-form";
import { StatusBadge } from "@/components/admin/status-badge";
import type { ReconciliationPayload } from "@/lib/reconciliation";

const initialState: ActionState = { status: "idle" };

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function enumerateDates(start: string, end: string) {
  if (!start || !end || start > end) {
    return [];
  }

  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);

  while (cursor <= endDate && dates.length < 62) {
    dates.push(toDateInput(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

type CellKey = `${string}:${string}`;

export function BulkStockEntryDialog({
  open,
  dbConnected,
  vehicleId,
  vehicleName,
  reconciliationProducts,
  onClose,
}: {
  open: boolean;
  dbConnected: boolean;
  vehicleId: string;
  vehicleName: string;
  reconciliationProducts: ReconciliationPayload["reconciliationProducts"];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(saveVehicleCycleStock, initialState);
  const today = toDateInput(new Date());
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [values, setValues] = useState<Map<CellKey, string>>(new Map());

  useEffect(() => {
    if (open && state.status === "success") {
      onClose();
    }
  }, [onClose, open, state.status]);

  const dates = useMemo(() => enumerateDates(startDate, endDate), [startDate, endDate]);

  const setValue = (date: string, productId: string, field: "given" | "returned", value: string) => {
    const key: CellKey = `${date}:${productId}:${field}` as CellKey;
    const next = new Map(values);
    next.set(key, value);
    setValues(next);
  };

  const getValue = (date: string, productId: string, field: "given" | "returned") =>
    values.get(`${date}:${productId}:${field}` as CellKey) ?? "0";

  const entries = dates.flatMap((date) =>
    reconciliationProducts.map((product) => ({
      cycleDate: date,
      productId: product.id,
      givenQty: getValue(date, product.id, "given"),
      returnedQty: getValue(date, product.id, "returned"),
    })),
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Catch-up stock entry — ${vehicleName}`}
      description="Back-fill given/returned quantities across several missed days in one go. Each date is a cycle close date."
      footer={null}
    >
      <KeyboardForm action={action} className="space-y-4">
        <input type="hidden" name="vehicleId" value={vehicleId} />
        <input type="hidden" name="entriesJson" value={JSON.stringify(entries)} readOnly />

        <div className="grid gap-4 md:grid-cols-2">
          <FormInput
            label="From date"
            name="startDate"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
          <FormInput
            label="To date"
            name="endDate"
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </div>

        {dates.length === 0 ? (
          <p className="text-sm text-text-secondary">Pick a valid date range (up to 62 days) to fill in.</p>
        ) : (
          <div className="max-h-[360px] overflow-auto rounded-lg border border-surface-border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="sticky top-0 bg-surface-muted/90 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-3 py-2.5 text-left">Date</th>
                  {reconciliationProducts.map((product) => (
                    <th key={product.id} className="px-3 py-2.5 text-center" colSpan={2}>
                      {product.name}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="px-3 py-1.5 text-left" />
                  {reconciliationProducts.map((product) => (
                    <Fragment key={product.id}>
                      <th className="px-2 py-1.5 text-right font-normal text-text-muted">Given</th>
                      <th className="px-2 py-1.5 text-right font-normal text-text-muted">Returned</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {dates.map((date) => (
                  <tr key={date}>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-text-primary">
                      {new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </td>
                    {reconciliationProducts.map((product) => (
                      <Fragment key={product.id}>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            value={getValue(date, product.id, "given")}
                            onChange={(event) => setValue(date, product.id, "given", event.target.value)}
                            className="h-8 w-20 rounded-md border border-surface-border-strong bg-surface px-2 text-right text-sm outline-none focus:border-accent"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            value={getValue(date, product.id, "returned")}
                            onChange={(event) => setValue(date, product.id, "returned", event.target.value)}
                            className="h-8 w-20 rounded-md border border-surface-border-strong bg-surface px-2 text-right text-sm outline-none focus:border-accent"
                          />
                        </td>
                      </Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {state.status !== "idle" && state.message ? (
          <p className={state.status === "success" ? "text-sm text-emerald-700" : "text-sm text-rose-700"}>
            {state.message}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-surface-border pt-4">
          <StatusBadge tone={dbConnected ? "success" : "warning"}>
            {dbConnected ? "Live data" : "Offline fallback"}
          </StatusBadge>
          <SecondaryButton type="button" onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={pending || dates.length === 0}>
            {pending ? "Saving..." : `Save ${dates.length || ""} day${dates.length === 1 ? "" : "s"}`}
          </PrimaryButton>
        </div>
      </KeyboardForm>
    </Dialog>
  );
}
