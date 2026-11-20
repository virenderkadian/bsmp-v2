"use client";

import { useState, useTransition } from "react";
import { bulkOptInUpdatesAction, previewUpdatesOptInAction, type PickerState, type WhatsAppActionState } from "@/app/whatsapp/actions";
import { RecipientPicker } from "@/app/whatsapp/recipient-picker";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";

// Delivery updates ("your delivery is completed") and payment updates ("we received your
// payment") are each a SEPARATE opt-in from general WhatsApp consent, because they can arrive
// every delivery day or after every payment. The office chooses which customers have agreed,
// by route, by vehicle, or one by one, and confirms that before it is recorded. Nobody is
// ticked to begin with: this is a deliberate act, not a default.
const COPY = {
  delivery: {
    title: "Delivery updates opt-in",
    messages: "\u201cYour delivery is completed\u201d messages",
    when: "arrive every delivery day",
    agreed: "These customers have agreed to get delivery updates on WhatsApp.",
  },
  payment: {
    title: "Payment updates opt-in",
    messages: "\u201cWe received your payment\u201d messages",
    when: "arrive after every payment",
    agreed: "These customers have agreed to get payment updates on WhatsApp.",
  },
} as const;

export function UpdatesOptInCard({ canSend, kind }: { canSend: boolean; kind: "delivery" | "payment" }) {
  const copy = COPY[kind];
  const [state, setState] = useState<PickerState>({ status: "idle" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<WhatsAppActionState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const load = () =>
    startTransition(async () => {
      setResult({ status: "idle" });
      setConfirmed(false);
      setSelected(new Set());
      setState(await previewUpdatesOptInAction(kind));
    });

  const optIn = () =>
    startTransition(async () => {
      const next = await bulkOptInUpdatesAction(kind, [...selected], confirmed);
      setResult(next);
      if (next.status === "success") {
        setSelected(new Set());
        setConfirmed(false);
        // The list changes: those customers are no longer waiting to be opted in.
        setState(await previewUpdatesOptInAction(kind));
      }
    });

  const ready = state.status === "ready" ? state : null;

  return (
    <div className="rounded-lg border border-surface-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-text-primary">{copy.title}</h2>
      <p className="mt-1 text-sm text-text-secondary">
        {copy.messages} need their own consent, on top of WhatsApp consent, because they can
        {" "}{copy.when}. Choose the customers who agreed to get them, for example a whole route or vehicle, and
        confirm. Only customers who already have WhatsApp consent are listed.
      </p>

      <div className="mt-3">
        <SecondaryButton type="button" onClick={load} disabled={!canSend || pending}>
          {pending && !ready ? "Loading…" : ready ? "Reload the list" : "Choose customers"}
        </SecondaryButton>
      </div>
      {!canSend ? <p className="mt-2 text-sm text-text-secondary">Only an admin can record consent.</p> : null}
      {state.status === "error" ? <p className="mt-2 text-sm text-status-danger-text">{state.message}</p> : null}
      {ready ? <p className="mt-2 text-sm text-text-primary">{ready.message}</p> : null}

      {ready && ready.rows.length > 0 ? (
        <div className="mt-3 space-y-3">
          <RecipientPicker rows={ready.rows} selected={selected} onChange={setSelected} disabled={pending || !canSend} detailHeading="Mobile number" />

          <label className="flex items-start gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={pending || !canSend}
            />
            <span>{copy.agreed}</span>
          </label>

          <PrimaryButton type="button" onClick={optIn} disabled={!canSend || pending || selected.size === 0 || !confirmed}>
            {pending ? "Recording…" : `Opt in ${selected.size} customer${selected.size === 1 ? "" : "s"}`}
          </PrimaryButton>
        </div>
      ) : null}

      {result.status !== "idle" && result.message ? (
        <p className={result.status === "error" ? "mt-2 text-sm text-status-danger-text" : "mt-2 text-sm text-status-success-text"}>
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
