"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { getCustomerRoutesForMonth, updatePayment, type PaymentActionState } from "@/app/payments/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { Dialog } from "@/components/admin/dialog";
import { FormInput } from "@/components/admin/form-input";
import { KeyboardForm } from "@/components/admin/keyboard-form";
import { SelectInput } from "@/components/admin/select-input";
import type { CustomerMonthPayment } from "@/lib/customer-month-entries";
import { paymentModes, paymentStatuses } from "@/lib/payment-options";
import type { PaymentRouteOption } from "@/lib/payments";

const idleState: PaymentActionState = { status: "idle" };

// Reuses payments/actions.ts's own updatePayment and getCustomerRoutesForMonth
// rather than inventing a parallel edit path — the same action that backs
// the Payments screen's edit dialog, just seeded from this customer's fixed
// id instead of a customer picker. Mounted only while editingPayment is set
// (see monthly-deliveries-screen.tsx), so each open starts from a clean,
// freshly-seeded form — same convention as PaymentDialog there.
export function PaymentEditDialog({
  payment,
  customerId,
  onClose,
  onSaved,
}: {
  payment: CustomerMonthPayment;
  customerId: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState(updatePayment, idleState);
  const [paymentDate, setPaymentDate] = useState(payment.paymentDate);
  const [routeId, setRouteId] = useState(payment.routeId ?? "");
  const [routes, setRoutes] = useState<PaymentRouteOption[]>([]);
  const requestId = useRef(0);

  useEffect(() => {
    if (state.status === "success") {
      onSaved(state.message ?? "Payment updated.");
    }
  }, [onSaved, state.status, state.message]);

  useEffect(() => {
    const id = ++requestId.current;
    const month = paymentDate.slice(0, 7);

    getCustomerRoutesForMonth(customerId, month).then((found) => {
      if (requestId.current !== id) {
        return;
      }

      setRoutes(found);
      if (found.length === 1) {
        setRouteId(found[0].id);
      } else if (found.length > 1) {
        setRouteId((current) => (found.some((route) => route.id === current) ? current : ""));
      }
    });
  }, [customerId, paymentDate]);

  return (
    <Dialog
      open
      title="Edit payment"
      description="Update what this customer paid — the same figure monthly bills and reconciliation read."
      onClose={onClose}
      footer={null}
    >
      <KeyboardForm action={formAction} className="space-y-4">
        <input type="hidden" name="id" value={payment.id} readOnly />
        <input type="hidden" name="customerId" value={customerId} readOnly />
        <div className="grid gap-4 md:grid-cols-2">
          <SelectInput
            label="Route"
            name="routeId"
            value={routeId}
            onChange={(event) => setRouteId(event.target.value)}
            placeholder={routes.length > 0 ? "Select route" : "No route found for this month"}
            options={routes.map((route) => ({
              value: route.id,
              label: `${route.code} - ${route.name} ${route.shift === "MORNING" ? "Morning" : "Evening"}`,
            }))}
          />
          <FormInput
            label="Amount"
            name="amount"
            type="number"
            min="0"
            step="0.01"
            defaultValue={payment.amount}
            autoFocus
          />
          <FormInput
            label="Payment date"
            name="paymentDate"
            type="date"
            value={paymentDate}
            onChange={(event) => {
              setPaymentDate(event.target.value);
              setRouteId("");
            }}
          />
          <SelectInput label="Mode" name="mode" defaultValue={payment.mode} options={paymentModes} />
          <SelectInput label="Status" name="status" defaultValue={payment.status} options={paymentStatuses} />
          <FormInput
            label="Reference no"
            name="referenceNo"
            placeholder="UPI / cheque / receipt"
            defaultValue={payment.referenceNo}
          />
          <div className="md:col-span-2">
            <FormInput label="Notes" name="notes" placeholder="Optional note" defaultValue={payment.notes} />
          </div>
        </div>
        {state.status === "error" && state.message ? (
          <p className="text-sm text-rose-700">{state.message}</p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-surface-border pt-4">
          <SecondaryButton type="button" onClick={onClose} disabled={pending}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={pending || !routeId}>
            {pending ? "Saving..." : "Update payment"}
          </PrimaryButton>
        </div>
      </KeyboardForm>
    </Dialog>
  );
}
