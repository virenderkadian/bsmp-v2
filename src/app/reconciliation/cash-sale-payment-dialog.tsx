"use client";

import { useActionState, useEffect, useState } from "react";
import { recordCashSalePayment, type ActionState } from "@/app/reconciliation/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { Dialog } from "@/components/admin/dialog";
import { FormInput } from "@/components/admin/form-input";
import { KeyboardForm } from "@/components/admin/keyboard-form";
import { SelectInput } from "@/components/admin/select-input";
import { StatusBadge } from "@/components/admin/status-badge";
import type { ReconciliationCycle } from "@/lib/reconciliation";

const initialState: ActionState = { status: "idle" };

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function CashSalePaymentDialog({
  open,
  dbConnected,
  cycle,
  onClose,
}: {
  open: boolean;
  dbConnected: boolean;
  cycle: ReconciliationCycle;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(recordCashSalePayment, initialState);
  const [paymentDate, setPaymentDate] = useState(toDateInput(new Date()));

  useEffect(() => {
    if (open && state.status === "success") {
      onClose();
    }
  }, [onClose, open, state.status]);

  const outstanding = Number(cycle.balance);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Record cash sale payment — ${cycle.vehicleName}`}
      description={`Cycle closing ${cycle.cycleDate}. Outstanding balance: ₹${outstanding.toFixed(2)}.`}
      footer={null}
    >
      <KeyboardForm action={action} className="space-y-4">
        <input type="hidden" name="vehicleId" value={cycle.vehicleId} />
        <input type="hidden" name="cycleDate" value={cycle.cycleDate} />
        <div className="grid gap-4 md:grid-cols-2">
          <FormInput
            label="Amount"
            name="amount"
            type="number"
            min="0"
            step="0.01"
            placeholder={outstanding.toFixed(2)}
            defaultValue={outstanding > 0 ? outstanding.toFixed(2) : ""}
            autoFocus
          />
          <FormInput
            label="Payment date"
            name="paymentDate"
            type="date"
            value={paymentDate}
            onChange={(event) => setPaymentDate(event.target.value)}
          />
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
          />
          <SelectInput
            label="Status"
            name="status"
            defaultValue="VERIFIED"
            options={[
              { value: "VERIFIED", label: "Verified" },
              { value: "PENDING", label: "Pending" },
            ]}
          />
          <FormInput label="Reference no." name="referenceNo" placeholder="Optional" />
          <FormInput label="Notes" name="notes" placeholder="Optional" />
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
            {pending ? "Recording..." : "Record payment"}
          </PrimaryButton>
        </div>
      </KeyboardForm>
    </Dialog>
  );
}
