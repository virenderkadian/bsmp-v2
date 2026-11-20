"use client";

import { useState, useTransition } from "react";
import { previewRemindersAction, queueRemindersAction, type ReminderState } from "@/app/whatsapp/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { ZOEPACT_TEMPLATES, monthNames } from "@/lib/notifications/zoepact-templates";

const money = (value: string) =>
  `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// What the customer reads, filled from the real template wording so this can't drift.
function preview(month: number, outstanding: string): string {
  const { hi, en } = monthNames(month);
  const amount = Number(outstanding).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return ZOEPACT_TEMPLATES.payment_reminder_hi_en_v1.body
    .replace("{{1}}", hi).replace("{{2}}", amount).replace("{{3}}", en).replace("{{4}}", amount);
}

// Reminders go to customers whose LATEST issued bill is unpaid — the same list the
// driver app's Dues screen shows. Nothing is queued until "Queue" is pressed, and
// pressing it twice in a day cannot message anyone twice.
export function RemindersPanel({ canSend }: { canSend: boolean }) {
  const [state, setState] = useState<ReminderState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const check = () => startTransition(async () => setState(await previewRemindersAction()));
  const queue = () => startTransition(async () => setState(await queueRemindersAction()));

  const ready = state.status === "ready" ? state : null;
  const first = ready?.sample[0];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text-primary">Payment reminders</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Reminds customers who still owe on their latest bill, with the true outstanding amount. Only customers with
          WhatsApp consent and a valid mobile number are included, and amounts under ₹10 are skipped. Messages go out
          between 9am and 8pm, in small batches.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <SecondaryButton type="button" onClick={check} disabled={pending || !canSend}>
            {pending ? "Checking…" : "Check who would get one"}
          </SecondaryButton>
          {ready && ready.eligible > 0 ? (
            <PrimaryButton type="button" onClick={queue} disabled={pending || !canSend}>
              Queue {ready.eligible} reminder{ready.eligible === 1 ? "" : "s"}
            </PrimaryButton>
          ) : null}
        </div>
        {!canSend ? <p className="mt-2 text-sm text-text-secondary">Only an admin can queue customer messages.</p> : null}
        {state.status === "error" ? <p className="mt-2 text-sm text-status-danger-text">{state.message}</p> : null}
        {state.status === "queued" ? <p className="mt-2 text-sm text-status-success-text">{state.message}</p> : null}
        {ready ? (
          <p className="mt-2 text-sm text-text-primary">
            {ready.message} {ready.eligible > 0 ? `Total outstanding: ${money(ready.totalOutstanding)}.` : ""}
          </p>
        ) : null}
      </div>

      {ready && ready.sample.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-surface-border bg-surface p-4">
            <h3 className="text-sm font-semibold text-text-primary">First {ready.sample.length} of {ready.eligible}</h3>
            <ul className="mt-2 divide-y divide-surface-border text-sm">
              {ready.sample.map((row) => (
                <li key={row.code} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="text-text-primary">{row.code} · {row.name}</span>
                  <span className="shrink-0 font-medium tabular-nums text-status-danger-text">{money(row.outstanding)}</span>
                </li>
              ))}
            </ul>
          </div>
          {first ? (
            <div className="rounded-lg border border-surface-border bg-surface p-4">
              <h3 className="text-sm font-semibold text-text-primary">What {first.name} receives</h3>
              <div className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-muted p-3 text-sm leading-relaxed text-text-primary">
                {preview(first.month, first.outstanding)}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {(ready?.skipped.length ?? 0) > 0 || (state.status === "queued" && state.skipped.length > 0) ? (
        <div className="rounded-lg border border-surface-border bg-surface p-4">
          <h3 className="text-sm font-semibold text-text-primary">
            Skipped ({state.status === "ready" || state.status === "queued" ? state.skipped.length : 0})
          </h3>
          <p className="mt-1 text-sm text-text-secondary">These customers owe money but won&apos;t get a reminder, and why.</p>
          <ul className="mt-2 max-h-64 divide-y divide-surface-border overflow-auto text-sm">
            {(state.status === "ready" || state.status === "queued" ? state.skipped : []).map((entry) => (
              <li key={entry.customerCode} className="flex items-baseline justify-between gap-4 py-1.5">
                <span className="text-text-primary">{entry.customerCode} · {entry.customerName}</span>
                <span className="shrink-0 text-text-secondary">{entry.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
