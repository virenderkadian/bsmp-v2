"use client";

import { useState, useTransition } from "react";
import { previewDeliveryUpdatesAction, queueDeliveryUpdatesAction, type DeliveryPickerState } from "@/app/whatsapp/actions";
import { RecipientPicker } from "@/app/whatsapp/recipient-picker";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { routeOptionsFor, vehicleOptionsFor } from "@/app/whatsapp/recipient-filter";
import { FormInput } from "@/components/admin/form-input";
import { SelectInput } from "@/components/admin/select-input";
import { ZOEPACT_TEMPLATES } from "@/lib/notifications/zoepact-templates";

// Today in India as YYYY-MM-DD, so the date box opens on the right day wherever the browser is.
function todayIst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

// "Your delivery is completed": the office picks a date, sees who was delivered what and
// what each came to, filters and ticks, then queues. Nothing is sent by itself when a
// driver saves a stop.
type Scope = "all" | "route" | "vehicle" | "customers";

export function DeliveryUpdatesPanel({ canSend, wording }: { canSend: boolean; wording: Record<string, { body: string; footer: string }> }) {
  const [day, setDay] = useState(todayIst);
  const [state, setState] = useState<DeliveryPickerState>({ status: "idle" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Who the update is for: everyone delivered that day, one route, one vehicle, or
  // specific customers picked by hand. The route and vehicle choices tick exactly that
  // group's customers; the list below can still be adjusted one by one.
  const [scope, setScope] = useState<Scope>("all");
  const [scopeId, setScopeId] = useState("");
  const [pending, startTransition] = useTransition();

  const find = () =>
    startTransition(async () => {
      const next = await previewDeliveryUpdatesAction(day);
      setState(next);
      setScope("all");
      setScopeId("");
      // Everyone who can get it starts ticked; the office removes the exceptions.
      setSelected(new Set(next.status === "ready" ? next.rows.map((row) => row.id) : []));
    });

  const queue = () =>
    startTransition(async () => {
      const next = await queueDeliveryUpdatesAction(day, [...selected]);
      setState(next);
      if (next.status === "queued") setSelected(new Set());
    });

  const changeDay = (value: string) => {
    setDay(value);
    // A list found for one date must not be queued under another.
    setState({ status: "idle" });
    setSelected(new Set());
    setScope("all");
    setScopeId("");
  };

  const ready = state.status === "ready" ? state : null;
  const allRows = ready?.rows ?? [];

  // Customers in the chosen route or vehicle (or all of them).
  const inScope = (nextScope: Scope, id: string) =>
    nextScope === "route" && id
      ? allRows.filter((row) => row.routeId === id)
      : nextScope === "vehicle" && id
        ? allRows.filter((row) => row.vehicleId === id)
        : allRows;

  // Changing who it is for re-ticks to match: a route or vehicle ticks exactly its
  // customers, "specific customers" starts with nobody ticked.
  const chooseScope = (nextScope: Scope, id = "") => {
    setScope(nextScope);
    setScopeId(id);
    if (nextScope === "all") setSelected(new Set(allRows.map((row) => row.id)));
    else if (nextScope === "customers") setSelected(new Set());
    else setSelected(new Set(id ? inScope(nextScope, id).map((row) => row.id) : []));
  };

  const shownRows = inScope(scope, scopeId);
  const routeChoices = routeOptionsFor(allRows, "").map((option) => ({
    ...option,
    label: `${option.label} (${allRows.filter((row) => row.routeId === option.value).length})`,
  }));
  const vehicleChoices = vehicleOptionsFor(allRows, "").map((option) => ({
    ...option,
    label: `${option.label} (${allRows.filter((row) => row.vehicleId === option.value).length})`,
  }));
  const sample = ready?.sample ?? null;
  const body = wording.delivery_completed_v1?.body ?? ZOEPACT_TEMPLATES.delivery_completed_v1.body;
  const footer = wording.delivery_completed_v1?.footer ?? ZOEPACT_TEMPLATES.delivery_completed_v1.footer;
  const money = sample ? Number(sample.amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";

  const message = sample
    ? [sample.date, sample.itemsText, money, sample.date, sample.itemsText, money].reduce(
        (text, value, index) => text.replace(`{{${index + 1}}}`, value),
        body,
      )
    : body;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4 rounded-lg border border-surface-border bg-surface p-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Delivery completed</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Pick a delivery date to see who was delivered what, and what each came to. Tick the customers who should get a
              &ldquo;your delivery is completed&rdquo; message. Only customers who opted in to delivery updates (on the Consent tab), and have a valid number
              and a delivery that day, are listed. Each customer gets one message per date. Messages go out in small batches during the sending hours.
            </p>
          </div>

          <FormInput label="Delivery date" type="date" value={day} onChange={(event) => changeDay(event.target.value)} />

          <div className="flex flex-wrap gap-2">
            <SecondaryButton type="button" onClick={find} disabled={!canSend || pending || !day}>
              {pending ? "Working…" : ready ? "Find again" : "Find deliveries"}
            </SecondaryButton>
            {ready && ready.rows.length > 0 ? (
              <PrimaryButton type="button" onClick={queue} disabled={!canSend || pending || selected.size === 0}>
                Queue {selected.size} delivery update{selected.size === 1 ? "" : "s"}
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
                  { value: "all", label: "Everyone delivered that day" },
                  { value: "route", label: "A whole route" },
                  { value: "vehicle", label: "A whole vehicle" },
                  { value: "customers", label: "Specific customers" },
                ]}
              />
              {scope === "route" ? (
                <SelectInput
                  label="Route"
                  value={scopeId}
                  onChange={(event) => chooseScope("route", event.target.value)}
                  disabled={pending || !canSend}
                  placeholder="Choose a route"
                  options={routeChoices}
                />
              ) : null}
              {scope === "vehicle" ? (
                <SelectInput
                  label="Vehicle"
                  value={scopeId}
                  onChange={(event) => chooseScope("vehicle", event.target.value)}
                  disabled={pending || !canSend}
                  placeholder="Choose a vehicle"
                  options={vehicleChoices}
                />
              ) : null}
              {scope === "customers" ? (
                <p className="text-sm text-text-secondary">Search below and tick the customers to send to.</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-surface-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text-primary">What the customer receives</h2>
          <div className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-surface-muted p-3 text-sm leading-relaxed text-text-primary">
            {message}
            {"\n\n"}
            {footer}
          </div>
          <p className="mt-2 text-xs text-text-secondary">
            {sample ? `Shown with ${sample.name}'s real figures.` : "Find deliveries to see a real example."} Each customer&apos;s message
            lists their own products, the price of each, and their total.
          </p>
        </div>
      </div>

      {ready && ready.rows.length > 0 ? (
        <div className="rounded-lg border border-surface-border bg-surface p-4">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Who gets a delivery update</h3>
          <RecipientPicker rows={shownRows} selected={selected} onChange={setSelected} disabled={pending || !canSend} detailHeading="Day's total" />
        </div>
      ) : null}
    </div>
  );
}
