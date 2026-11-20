"use client";

import { useActionState, useState } from "react";
import { queueMonthlyBills, type WhatsAppActionState } from "@/app/whatsapp/actions";
import { PrimaryButton } from "@/components/admin/buttons";
import { EmptyState } from "@/components/admin/empty-state";
import { SelectInput } from "@/components/admin/select-input";
import { SummaryStatBar } from "@/components/admin/summary-stat-bar";
import type { ConsentSummary } from "@/lib/notifications/consent";
import { ZOEPACT_TEMPLATES } from "@/lib/notifications/zoepact-templates";
import type { SendableMonth } from "@/lib/notifications/outbox";

const initialState: WhatsAppActionState = { status: "idle" };

// Filled from the real template wording rather than hand-written, so the preview
// can never drift from what customers actually receive.
const PREVIEW = [
  ZOEPACT_TEMPLATES.monthly_bill_link_v1.body
    .replace("{{1}}", "Ramesh Kumar").replace("{{2}}", "अगस्त").replace("{{3}}", "2,340.00")
    .replace("{{4}}", "Ramesh Kumar").replace("{{5}}", "August").replace("{{6}}", "2,340.00"),
  ZOEPACT_TEMPLATES.monthly_bill_link_v1.footer,
  "[ View bill ]",
].join("\n\n");

export function SendBillsPanel({
  canSend,
  months,
  consentSummary,
}: {
  canSend: boolean;
  months: SendableMonth[];
  consentSummary: ConsentSummary;
}) {
  const [state, formAction, pending] = useActionState(queueMonthlyBills, initialState);
  const [selectedMonth, setSelectedMonth] = useState(months[0]?.value ?? "");

  if (months.length === 0) {
    return (
      <EmptyState message="No generated bills yet. Generate a month's bills first — draft bills are never sent, because their figures can still change." />
    );
  }

  const month = months.find((entry) => entry.value === selectedMonth);

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
        <form action={formAction} className="space-y-4 rounded-lg border border-surface-border bg-surface p-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Queue this month&apos;s bills</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Messages are queued here and sent through WhatsApp in small batches between 9am and 8pm.
              Nothing is sent from this screen directly. Each message has a View bill button that opens the
              customer&apos;s bill.
            </p>
          </div>

          <SelectInput
            label="Billing month"
            name="billingMonth"
            value={selectedMonth}
            onChange={(event) => setSelectedMonth(event.target.value)}
            options={months.map((entry) => ({
              value: entry.value,
              label: `${entry.label} — ${entry.billCount} bill${entry.billCount === 1 ? "" : "s"}`,
            }))}
          />

          {consentSummary.optedIn === 0 ? (
            <p className="text-sm text-amber-700">
              No customer has WhatsApp consent recorded yet. Open the Consent tab first — nothing will
              queue until at least one customer has opted in.
            </p>
          ) : null}

          <PrimaryButton type="submit" disabled={!canSend || pending || consentSummary.optedIn === 0}>
            {pending ? "Queueing…" : `Queue ${month?.billCount ?? 0} bill message(s)`}
          </PrimaryButton>

          {!canSend ? (
            <p className="text-sm text-text-secondary">Only an admin can queue customer messages.</p>
          ) : null}

          {state.status !== "idle" && state.message ? (
            <p className={state.status === "error" ? "text-sm text-rose-700" : "text-sm text-emerald-700"}>
              {state.message}
            </p>
          ) : null}
        </form>

        <div className="rounded-lg border border-surface-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text-primary">What the customer receives</h2>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-md bg-surface-muted p-3 font-mono text-xs leading-relaxed text-text-primary">
            {PREVIEW}
          </pre>
          <p className="mt-2 text-xs text-text-secondary">
            Example figures. Real messages use each customer&apos;s own name and amount. The View bill page
            shows the full bill, and a Pay with UPI button when a UPI ID is set and something is owed.
          </p>
        </div>
      </div>

      {state.skipped && state.skipped.length > 0 ? (
        <div className="rounded-lg border border-surface-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text-primary">
            Skipped ({state.skipped.length})
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            These customers were not queued. Nothing was sent to them.
          </p>
          <ul className="mt-3 divide-y divide-surface-border text-sm">
            {state.skipped.map((entry) => (
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
