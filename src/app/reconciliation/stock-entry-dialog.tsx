"use client";

import { useActionState, useEffect, useState } from "react";
import { saveVehicleCycleStock, type ActionState } from "@/app/reconciliation/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { Dialog } from "@/components/admin/dialog";
import { KeyboardForm } from "@/components/admin/keyboard-form";
import { StatusBadge } from "@/components/admin/status-badge";
import type { ReconciliationCycle, ReconciliationPayload } from "@/lib/reconciliation";

const initialState: ActionState = { status: "idle" };

export function StockEntryDialog({
  open,
  dbConnected,
  cycle,
  reconciliationProducts,
  onClose,
}: {
  open: boolean;
  dbConnected: boolean;
  cycle: ReconciliationCycle;
  reconciliationProducts: ReconciliationPayload["reconciliationProducts"];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(saveVehicleCycleStock, initialState);
  const [rows, setRows] = useState(
    () =>
      new Map(
        cycle.products.map((product) => [
          product.productId,
          { given: product.given, returned: product.returned },
        ]),
      ),
  );

  useEffect(() => {
    if (open && state.status === "success") {
      onClose();
    }
  }, [onClose, open, state.status]);

  const entries = reconciliationProducts.map((product) => {
    const row = rows.get(product.id) ?? { given: "0", returned: "0" };
    return {
      cycleDate: cycle.cycleDate,
      productId: product.id,
      givenQty: row.given,
      returnedQty: row.returned,
    };
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Vehicle stock — ${cycle.vehicleName}`}
      description={`Milk given at evening dispatch (${cycle.eveningDate}) and returned at morning close (${cycle.cycleDate}).`}
      footer={null}
    >
      <KeyboardForm action={action} className="space-y-4">
        <input type="hidden" name="vehicleId" value={cycle.vehicleId} />
        <input type="hidden" name="entriesJson" value={JSON.stringify(entries)} readOnly />

        <div className="overflow-x-auto rounded-lg border border-surface-border">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="bg-surface-muted/70 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              <tr>
                <th className="px-4 py-2.5 text-left">Product</th>
                <th className="px-4 py-2.5 text-right">Given (evening)</th>
                <th className="px-4 py-2.5 text-right">Returned (morning)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {reconciliationProducts.map((product) => {
                const row = rows.get(product.id) ?? { given: "0", returned: "0" };
                return (
                  <tr key={product.id}>
                    <td className="px-4 py-2.5 font-medium text-text-primary">
                      {product.name} <span className="text-text-muted">({product.unit})</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={row.given}
                        onChange={(event) => {
                          const next = new Map(rows);
                          next.set(product.id, { ...row, given: event.target.value });
                          setRows(next);
                        }}
                        className="h-9 w-full rounded-md border border-surface-border-strong bg-surface px-2 text-right text-sm outline-none focus:border-accent"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={row.returned}
                        onChange={(event) => {
                          const next = new Map(rows);
                          next.set(product.id, { ...row, returned: event.target.value });
                          setRows(next);
                        }}
                        className="h-9 w-full rounded-md border border-surface-border-strong bg-surface px-2 text-right text-sm outline-none focus:border-accent"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

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
          <PrimaryButton type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save stock"}
          </PrimaryButton>
        </div>
      </KeyboardForm>
    </Dialog>
  );
}
