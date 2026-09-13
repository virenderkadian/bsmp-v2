"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createDoorstepPayment,
  fetchBillQuickView,
  type PaymentActionState,
} from "@/app/payments/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { Dialog } from "@/components/admin/dialog";
import { FormInput } from "@/components/admin/form-input";
import { KeyboardForm } from "@/components/admin/keyboard-form";
import { SelectInput } from "@/components/admin/select-input";
import type { BillQuickView } from "@/lib/payments";
import { cn } from "@/lib/utils";

const initialState: PaymentActionState = { status: "idle" };

function monthName(value: string) {
  return new Date(`${value}-01T00:00:00.000Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function money(value: string | number) {
  return `₹${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export type DoorstepPaymentTarget = {
  customerId: string;
  customerName: string;
  customerCode: string;
};

// Taking money while the round is being entered.
//
// Rendered outside the Daily Entry form on purpose: a form inside a form is
// invalid HTML, and this has to be able to save on its own. A payment must not
// be lost because the sheet later failed validation, and must not be re-sent
// when the sheet is saved again.
export function DoorstepPaymentDialog({
  target,
  routeId,
  paymentDate,
  onClose,
  onRecorded,
}: {
  target: DoorstepPaymentTarget | null;
  routeId: string;
  paymentDate: string;
  onClose: () => void;
  onRecorded: (message: string) => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={target ? `Take payment — ${target.customerName}` : "Take payment"}
      description="Recorded against this round and today's date, and counted straight away."
      footer={null}
    >
      {/* Keyed by customer so every field, the submission id and the action
          result start fresh — the alternative is an effect resetting half a
          dozen pieces of state whenever the target changes. */}
      {target ? (
        <PaymentForm
          key={target.customerId}
          target={target}
          routeId={routeId}
          paymentDate={paymentDate}
          onClose={onClose}
          onRecorded={onRecorded}
        />
      ) : null}
    </Dialog>
  );
}

function PaymentForm({
  target,
  routeId,
  paymentDate,
  onClose,
  onRecorded,
}: {
  target: DoorstepPaymentTarget;
  routeId: string;
  paymentDate: string;
  onClose: () => void;
  onRecorded: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState(createDoorstepPayment, initialState);
  const [quickView, setQuickView] = useState<BillQuickView | null>(null);
  const [loadingView, setLoadingView] = useState(true);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  // Controlled, not uncontrolled: React resets a form once its action returns,
  // so a failed submit — the duplicate warning, most of all — would wipe the
  // amount just as the operator is being asked to confirm it, and the retry
  // would post an empty field. The customer form was bitten by exactly this.
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("CASH");
  // One id per open dialog. A retried request lands on the primary key rather
  // than writing the money a second time.
  const [submissionId] = useState(() => crypto.randomUUID());
  // A ref rather than state: this only guards the effect below from firing
  // twice, and is never read while rendering.
  const handledTokenRef = useRef<string | null>(null);

  const customerId = target.customerId;
  const month = paymentDate.slice(0, 7);
  const message = state.message;

  useEffect(() => {
    let cancelled = false;

    fetchBillQuickView(customerId, month)
      .then((view) => {
        if (!cancelled) {
          setQuickView(view);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingView(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [customerId, month]);

  // Close on a recorded payment, and hand the message up so the screen can say
  // so. Keyed on the action's token, which is unique per completed action, so
  // two payments of the same amount are both acknowledged.
  //
  // In an effect, not during render: onRecorded and onClose both set state on
  // the parent, and updating a parent while rendering a child is exactly what
  // React forbids — it tore the page down mid-test rather than warning.
  const token = state.status === "success" ? state.token : undefined;

  useEffect(() => {
    if (!token || token === handledTokenRef.current) {
      return;
    }

    handledTokenRef.current = token;
    onRecorded(message ?? "Payment recorded.");
    onClose();
  }, [token, message, onRecorded, onClose]);

  const duplicateWarning =
    state.status === "error" && (state.message?.startsWith("Already recorded") ?? false);

  return (
    <KeyboardForm action={formAction} className="space-y-4">
      <input type="hidden" name="submissionId" value={submissionId} readOnly />
      <input type="hidden" name="customerId" value={target.customerId} readOnly />
      <input type="hidden" name="routeId" value={routeId} readOnly />
      <input type="hidden" name="paymentDate" value={paymentDate} readOnly />
      <input
        type="hidden"
        name="confirmDuplicate"
        value={confirmDuplicate ? "true" : "false"}
        readOnly
      />

      {/* What they owe, before the amount box — so the figure being collected
          is a decision rather than a guess. */}
      <div className="rounded-lg border border-surface-border bg-surface-muted px-3 py-2.5 text-sm">
        {loadingView ? (
          <p className="text-text-secondary">Checking what is owed…</p>
        ) : quickView?.found ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            {/* Without this the three figures below do not add up, and an
                operator standing at a door cannot tell whether the outstanding
                is right. */}
            {Number(quickView.openingBalance) !== 0 ? (
              <>
                <dt className="text-text-secondary">Previous balance</dt>
                <dd className="text-right font-medium tabular-nums text-text-primary">
                  {money(quickView.openingBalance)}
                </dd>
              </>
            ) : null}
            <dt className="text-text-secondary">This month</dt>
            <dd className="text-right font-medium tabular-nums text-text-primary">
              {money(quickView.deliveryAmount)}
            </dd>
            <dt className="text-text-secondary">Already paid</dt>
            <dd className="text-right font-medium tabular-nums text-status-success-text">
              {money(quickView.paymentAmount)}
            </dd>
            <dt className="font-semibold text-text-primary">Outstanding</dt>
            <dd className="text-right font-bold tabular-nums text-rose-700">
              {money(quickView.closingBalance)}
            </dd>
          </dl>
        ) : (
          <p className="text-text-secondary">
            No bill for this month yet — the amount is whatever was handed over.
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <FormInput
          label="Amount"
          name="amount"
          type="number"
          step="0.01"
          autoFocus
          placeholder="0.00"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <SelectInput
          label="Mode"
          name="mode"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
          options={[
            { value: "CASH", label: "Cash" },
            { value: "UPI", label: "UPI" },
            { value: "BANK_TRANSFER", label: "Bank transfer" },
            { value: "CHEQUE", label: "Cheque" },
          ]}
          className="h-10 rounded-md bg-surface text-sm"
        />
      </div>

      {/* Where the money actually goes. It attaches to the earliest month not
          yet locked, which is often not the month being worked in — and an
          operator should not have to deduce that from lock status. */}
      {quickView?.settlesOn ? (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            quickView.alsoOpenMonths.length > 0
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-surface-border bg-surface text-text-secondary",
          )}
        >
          <p>
            Settles against <span className="font-semibold">{monthName(quickView.settlesOn)}</span>
            {quickView.settlesOn !== paymentDate.slice(0, 7)
              ? " — the earliest month still open for this customer."
              : "."}
          </p>
          {quickView.alsoOpenMonths.length > 0 ? (
            <p className="mt-1">
              It will also show against{" "}
              {quickView.alsoOpenMonths.map((month) => monthName(month)).join(", ")} until{" "}
              {monthName(quickView.settlesOn)} is locked.
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-text-secondary">
        {target.customerCode} · collected on {paymentDate}
      </p>

      {state.status === "error" && state.message ? (
        <p className="text-sm text-rose-700">{state.message}</p>
      ) : null}

      {/* Two genuine payments in one day are possible, so this confirms rather
          than blocks. */}
      {duplicateWarning ? (
        <label className="flex items-center gap-2 text-sm font-medium text-amber-700">
          <input
            type="checkbox"
            checked={confirmDuplicate}
            onChange={(event) => setConfirmDuplicate(event.target.checked)}
            className="h-4 w-4"
          />
          Record this as a second payment today
        </label>
      ) : null}

      <div className="flex justify-end gap-3 border-t border-surface-border pt-4">
        <SecondaryButton type="button" onClick={onClose}>
          Cancel
        </SecondaryButton>
        <PrimaryButton type="submit" disabled={pending}>
          {pending ? "Recording..." : "Record payment"}
        </PrimaryButton>
      </div>
    </KeyboardForm>
  );
}
