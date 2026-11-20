"use client";

import { useState, useTransition } from "react";
import { previewRemindersAction, queueRemindersAction, type PickerState } from "@/app/whatsapp/actions";
import { RecipientPicker } from "@/app/whatsapp/recipient-picker";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { ZOEPACT_TEMPLATES, monthNames } from "@/lib/notifications/zoepact-templates";

const money = (value: string) =>
  `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// What the customer reads, filled from the real template wording so this can't drift.
function preview(body: string, month: number, amount: string): string {
  const { hi, en } = monthNames(month);
  return body.replace("{{1}}", hi).replace("{{2}}", amount).replace("{{3}}", en).replace("{{4}}", amount);
}

// Reminders go to customers whose LATEST issued bill is unpaid — the same list the
// driver app's Dues screen shows. The office sees everyone eligible, unticks anyone
// who shouldn't get one, and only then queues. Pressing it twice in a day cannot
// message anyone twice.
export function RemindersPanel({ canSend, wording }: { canSend: boolean; wording: Record<string, { body: string; footer: string }> }) {
  const [state, setState] = useState<PickerState>({ status: "idle" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const check = () =>
    startTransition(async () => {
      const next = await previewRemindersAction();
      setState(next);
      // Everyone eligible starts ticked; the office removes the exceptions.
      setSelected(new Set(next.status === "ready" ? next.rows.map((row) => row.id) : []));
    });

  const queue = () =>
    startTransition(async () => {
      const next = await queueRemindersAction([...selected]);
      setState(next);
      if (next.status === "queued") setSelected(new Set());
    });

  const ready = state.status === "ready" ? state : null;
  const skipped = state.status === "ready" || state.status === "queued" ? state.skipped : [];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text-primary">Payment reminders</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Reminds customers who still owe on their latest bill, with the true outstanding amount. Only customers with
          WhatsApp consent and a valid mobile number are eligible, and amounts under ₹10 are skipped. Untick anyone who
          shouldn&apos;t get one. Messages go out between 9am and 8pm, in small batches.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <SecondaryButton type="button" onClick={check} disabled={pending || !canSend}>
            {pending ? "Working…" : ready ? "Check again" : "Check who is eligible"}
          </SecondaryButton>
          {ready && ready.rows.length > 0 ? (
            <PrimaryButton type="button" onClick={queue} disabled={pending || !canSend || selected.size === 0}>
              Queue {selected.size} reminder{selected.size === 1 ? "" : "s"}
            </PrimaryButton>
          ) : null}
        </div>
        {!canSend ? <p className="mt-2 text-sm text-text-secondary">Only an admin can queue customer messages.</p> : null}
        {state.status === "error" ? <p className="mt-2 text-sm text-status-danger-text">{state.message}</p> : null}
        {state.status === "queued" ? <p className="mt-2 text-sm text-status-success-text">{state.message}</p> : null}
        {ready ? (
          <p className="mt-2 text-sm text-text-primary">
            {ready.message} {ready.rows.length > 0 && ready.totalOutstanding ? `Total outstanding: ${money(ready.totalOutstanding)}.` : ""}
          </p>
        ) : null}
      </div>

      {ready && ready.rows.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <div className="rounded-lg border border-surface-border bg-surface p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-primary">Who gets a reminder</h3>
            <RecipientPicker
              rows={ready.rows}
              selected={selected}
              onChange={setSelected}
              disabled={pending || !canSend}
              detailHeading="Amount outstanding"
            />
          </div>
          <div className="rounded-lg border border-surface-border bg-surface p-4">
            <h3 className="text-sm font-semibold text-text-primary">What the customer receives</h3>
            <div className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-surface-muted p-3 text-sm leading-relaxed text-text-primary">
              {preview(wording.payment_reminder_hi_en_v1?.body ?? ZOEPACT_TEMPLATES.payment_reminder_hi_en_v1.body, new Date().getMonth() === 0 ? 12 : new Date().getMonth(), "2,040.00")}
            </div>
            <p className="mt-2 text-xs text-text-secondary">
              Example figures. Each reminder uses that customer&apos;s own month and amount.
            </p>
          </div>
        </div>
      ) : null}

      {skipped.length > 0 ? (
        <div className="rounded-lg border border-surface-border bg-surface p-4">
          <h3 className="text-sm font-semibold text-text-primary">Skipped ({skipped.length})</h3>
          <p className="mt-1 text-sm text-text-secondary">These customers owe money but can&apos;t get a reminder, and why.</p>
          <ul className="mt-2 max-h-64 divide-y divide-surface-border overflow-auto text-sm">
            {skipped.map((entry) => (
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
