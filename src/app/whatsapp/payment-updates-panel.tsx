"use client";

import { useState, useTransition } from "react";
import { previewPaymentUpdatesAction, queuePaymentUpdatesAction, type PaymentPickerState } from "@/app/whatsapp/actions";
import { routeOptionsFor, vehicleOptionsFor } from "@/app/whatsapp/recipient-filter";
import { RecipientPicker } from "@/app/whatsapp/recipient-picker";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { FormInput } from "@/components/admin/form-input";
import { SelectInput } from "@/components/admin/select-input";
import { paymentReceivedValues, ZOEPACT_TEMPLATES } from "@/lib/notifications/zoepact-templates";

// Today in India as YYYY-MM-DD, so the date boxes open on the right day wherever the browser is.
function todayIst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

type Scope = "all" | "route" | "vehicle" | "customers";

// "We received your payment": the office picks a date range and sees the VERIFIED payments in
// it, ticks the ones to confirm to the customer, and queues. Only payments the office has
// verified are listed, and only for customers who opted in to payment updates (Consent tab).
// Nothing is sent by itself when a payment is recorded.
export function PaymentUpdatesPanel({ canSend, wording }: { canSend: boolean; wording: Record<string, { body: string; footer: string }> }) {
  const [from, setFrom] = useState(todayIst);
  const [to, setTo] = useState(todayIst);
  const [state, setState] = useState<PaymentPickerState>({ status: "idle" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<Scope>("all");
  const [scopeId, setScopeId] = useState("");
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setState({ status: "idle" });
    setSelected(new Set());
    setScope("all");
    setScopeId("");
  };

  const find = () =>
    startTransition(async () => {
      const next = await previewPaymentUpdatesAction(from, to);
      setState(next);
      setScope("all");
      setScopeId("");
      // Every payment that can get a receipt starts ticked; the office removes the exceptions.
      setSelected(new Set(next.status === "ready" ? next.rows.map((row) => row.id) : []));
    });

  const queue = () =>
    startTransition(async () => {
      const next = await queuePaymentUpdatesAction(from, to, [...selected]);
      setState(next);
      if (next.status === "queued") setSelected(new Set());
    });

  const ready = state.status === "ready" ? state : null;
  const allRows = ready?.rows ?? [];

  const inScope = (nextScope: Scope, id: string) =>
    nextScope === "route" && id
      ? allRows.filter((row) => row.routeId === id)
      : nextScope === "vehicle" && id
        ? allRows.filter((row) => row.vehicleId === id)
        : allRows;

  // A route or vehicle ticks exactly its payments; "specific payments" starts with none ticked.
  const chooseScope = (nextScope: Scope, id = "") => {
    setScope(nextScope);
    setScopeId(id);
    if (nextScope === "all") setSelected(new Set(allRows.map((row) => row.id)));
    else if (nextScope === "customers") setSelected(new Set());
    else setSelected(new Set(id ? inScope(nextScope, id).map((row) => row.id) : []));
  };

  const shownRows = inScope(scope, scopeId);
  const routeChoices = routeOptionsFor(allRows, "").map((option) => ({ ...option, label: `${option.label} (${allRows.filter((row) => row.routeId === option.value).length})` }));
  const vehicleChoices = vehicleOptionsFor(allRows, "").map((option) => ({ ...option, label: `${option.label} (${allRows.filter((row) => row.vehicleId === option.value).length})` }));

  const sample = ready?.sample ?? null;
  const template = wording.payment_received_v1 ?? ZOEPACT_TEMPLATES.payment_received_v1;
  const message = sample
    ? paymentReceivedValues({ amount: sample.amount, date: sample.date, mode: sample.mode }).reduce((text, value, index) => text.replace(`{{${index + 1}}}`, value), template.body)
    : template.body;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4 rounded-lg border border-surface-border bg-surface p-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Payment received</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Pick the dates, then tick the payments to confirm to the customer. Only payments you have <strong className="font-semibold text-text-primary">verified</strong> are
              listed, and only for customers who opted in to payment updates (on the Consent tab). Each payment gets one message. Messages go out in
              small batches during the sending hours.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormInput label="From" type="date" value={from} onChange={(event) => { setFrom(event.target.value); reset(); }} />
            <FormInput label="To" type="date" value={to} onChange={(event) => { setTo(event.target.value); reset(); }} />
          </div>

          <div className="flex flex-wrap gap-2">
            <SecondaryButton type="button" onClick={find} disabled={!canSend || pending || !from || !to}>
              {pending ? "Working…" : ready ? "Find again" : "Find verified payments"}
            </SecondaryButton>
            {ready && ready.rows.length > 0 ? (
              <PrimaryButton type="button" onClick={queue} disabled={!canSend || pending || selected.size === 0}>
                Queue {selected.size} receipt{selected.size === 1 ? "" : "s"}
              </PrimaryButton>
            ) : null}
          </div>
          {!canSend ? <p className="text-sm text-text-secondary">Only an admin can queue customer messages.</p> : null}
          {state.status === "error" ? <p className="text-sm text-status-danger-text">{state.message}</p> : null}
          {state.status === "queued" ? <p className="text-sm text-status-success-text">{state.message}</p> : null}
          {ready ? <p className="text-sm text-text-primary">{ready.message}</p> : null}

          {ready && ready.rows.length > 0 ? (
            <div className="space-y-3 border-t border-surface-border pt-4">
              <SelectInput
                label="Send to"
                value={scope}
                onChange={(event) => chooseScope(event.target.value as Scope)}
                disabled={pending || !canSend}
                options={[
                  { value: "all", label: "Every payment found" },
                  { value: "route", label: "A whole route" },
                  { value: "vehicle", label: "A whole vehicle" },
                  { value: "customers", label: "Specific payments" },
                ]}
              />
              {scope === "route" ? (
                <SelectInput label="Route" value={scopeId} onChange={(event) => chooseScope("route", event.target.value)} disabled={pending || !canSend} placeholder="Choose a route" options={routeChoices} />
              ) : null}
              {scope === "vehicle" ? (
                <SelectInput label="Vehicle" value={scopeId} onChange={(event) => chooseScope("vehicle", event.target.value)} disabled={pending || !canSend} placeholder="Choose a vehicle" options={vehicleChoices} />
              ) : null}
              {scope === "customers" ? <p className="text-sm text-text-secondary">Search below and tick the payments to confirm.</p> : null}
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-surface-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text-primary">What the customer receives</h2>
          <div className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-surface-muted p-3 text-sm leading-relaxed text-text-primary">
            {message}
            {"\n\n"}
            {template.footer}
          </div>
          <p className="mt-2 text-xs text-text-secondary">
            {sample ? `Shown with ${sample.name}'s real payment.` : "Find verified payments to see a real example."} It states the amount,
            the date and how it was paid.
          </p>
        </div>
      </div>

      {ready && ready.rows.length > 0 ? (
        <div className="rounded-lg border border-surface-border bg-surface p-4">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Which payments get a receipt</h3>
          <RecipientPicker rows={shownRows} selected={selected} onChange={setSelected} disabled={pending || !canSend} detailHeading="Amount received" />
        </div>
      ) : null}
    </div>
  );
}
