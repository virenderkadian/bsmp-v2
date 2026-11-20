"use client";

import { useState, useTransition } from "react";
import { previewBillsAction, queueBillsAction, type PickerState } from "@/app/whatsapp/actions";
import { RecipientPicker } from "@/app/whatsapp/recipient-picker";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { EmptyState } from "@/components/admin/empty-state";
import { SelectInput } from "@/components/admin/select-input";
import { SummaryStatBar } from "@/components/admin/summary-stat-bar";
import type { ConsentSummary } from "@/lib/notifications/consent";
import type { SendableMonth } from "@/lib/notifications/outbox";
import { ZOEPACT_TEMPLATES } from "@/lib/notifications/zoepact-templates";

// Filled from the wording actually in use, so the preview can never drift from what
// customers receive (including after the message has been reworded).
function previewOf(wording: Record<string, { body: string; footer: string; buttonText?: string | null }>): string {
  const template = wording.monthly_bill_link_v1 ?? ZOEPACT_TEMPLATES.monthly_bill_link_v1;
  const body = template.body
    .replace("{{1}}", "Ramesh Kumar").replace("{{2}}", "अगस्त").replace("{{3}}", "2,340.00")
    .replace("{{4}}", "Ramesh Kumar").replace("{{5}}", "August").replace("{{6}}", "2,340.00");
  const button = "buttonText" in template && template.buttonText ? template.buttonText : "View bill";
  return [body, template.footer, `[ ${button} ]`].join("\n\n");
}

// Same steps as the Reminders tab: see the eligible customers for the month, untick
// anyone who shouldn't get a message, then queue exactly the ticked ones.
export function SendBillsPanel({
  canSend,
  months,
  consentSummary,
  wording,
}: {
  canSend: boolean;
  months: SendableMonth[];
  consentSummary: ConsentSummary;
  wording: Record<string, { body: string; footer: string; buttonText?: string | null }>;
}) {
  const [selectedMonth, setSelectedMonth] = useState(months[0]?.value ?? "");
  const [state, setState] = useState<PickerState>({ status: "idle" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  if (months.length === 0) {
    return (
      <EmptyState message="No generated bills yet. Generate a month's bills first — draft bills are never sent, because their figures can still change." />
    );
  }

  const check = () =>
    startTransition(async () => {
      const next = await previewBillsAction(selectedMonth);
      setState(next);
      setSelected(new Set(next.status === "ready" ? next.rows.map((row) => row.id) : []));
    });

  const queue = () =>
    startTransition(async () => {
      const next = await queueBillsAction(selectedMonth, [...selected]);
      setState(next);
      if (next.status === "queued") setSelected(new Set());
    });

  const changeMonth = (value: string) => {
    setSelectedMonth(value);
    // A list built for one month must not be queued under another.
    setState({ status: "idle" });
    setSelected(new Set());
  };

  const ready = state.status === "ready" ? state : null;
  const skipped = state.status === "ready" || state.status === "queued" ? state.skipped : [];

  return (
    <div className="space-y-4">
      <SummaryStatBar
        stats={[
          { key: "optedIn", label: "Can message", value: String(consentSummary.optedIn), tone: "success" },
          { key: "noConsent", label: "No consent", value: String(consentSummary.eligibleNotOptedIn) },
          {
            key: "unreachable",
            label: "No usable number",
            value: String(consentSummary.unreachable),
            tone: consentSummary.unreachable > 0 ? "danger" : "default",
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4 rounded-lg border border-surface-border bg-surface p-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Queue this month&apos;s bills</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Check who is eligible, untick anyone who shouldn&apos;t get a message, then queue the rest. Messages are sent
              through WhatsApp in small batches between 9am and 8pm. Each has a View bill button that opens the
              customer&apos;s bill.
            </p>
          </div>

          <SelectInput
            label="Billing month"
            name="billingMonth"
            value={selectedMonth}
            onChange={(event) => changeMonth(event.target.value)}
            options={months.map((entry) => ({
              value: entry.value,
              label: `${entry.label} — ${entry.billCount} bill${entry.billCount === 1 ? "" : "s"}`,
            }))}
          />

          {consentSummary.optedIn === 0 ? (
            <p className="text-sm text-status-warning-text">
              No customer has WhatsApp consent recorded yet. Open the Consent tab first — nothing will
              queue until at least one customer has opted in.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <SecondaryButton type="button" onClick={check} disabled={!canSend || pending || consentSummary.optedIn === 0}>
              {pending ? "Working…" : ready ? "Check again" : "Check who is eligible"}
            </SecondaryButton>
            {ready && ready.rows.length > 0 ? (
              <PrimaryButton type="button" onClick={queue} disabled={!canSend || pending || selected.size === 0}>
                Queue {selected.size} bill message{selected.size === 1 ? "" : "s"}
              </PrimaryButton>
            ) : null}
          </div>

          {!canSend ? <p className="text-sm text-text-secondary">Only an admin can queue customer messages.</p> : null}
          {state.status === "error" ? <p className="text-sm text-status-danger-text">{state.message}</p> : null}
          {state.status === "queued" ? <p className="text-sm text-status-success-text">{state.message}</p> : null}
          {ready ? <p className="text-sm text-text-primary">{ready.message}</p> : null}
        </div>

        <div className="rounded-lg border border-surface-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text-primary">What the customer receives</h2>
          <div className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-surface-muted p-3 text-sm leading-relaxed text-text-primary">
            {previewOf(wording)}
          </div>
          <p className="mt-2 text-xs text-text-secondary">
            Example figures. Real messages use each customer&apos;s own name and amount. The View bill page
            shows the full bill, and a Pay with UPI button when a UPI ID is set and something is owed.
          </p>
        </div>
      </div>

      {ready && ready.rows.length > 0 ? (
        <div className="rounded-lg border border-surface-border bg-surface p-4">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Who gets a bill message</h3>
          <RecipientPicker
            rows={ready.rows}
            selected={selected}
            onChange={setSelected}
            disabled={pending || !canSend}
            detailHeading="Amount due"
          />
        </div>
      ) : null}

      {skipped.length > 0 ? (
        <div className="rounded-lg border border-surface-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text-primary">Skipped ({skipped.length})</h2>
          <p className="mt-1 text-sm text-text-secondary">These customers were not queued. Nothing was sent to them.</p>
          <ul className="mt-3 max-h-64 divide-y divide-surface-border overflow-auto text-sm">
            {skipped.map((entry) => (
              <li key={entry.customerCode} className="flex items-baseline justify-between gap-4 py-2">
                <span className="text-text-primary">
                  {entry.customerCode} · {entry.customerName}
                </span>
                <span className="shrink-0 text-text-secondary">{entry.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
