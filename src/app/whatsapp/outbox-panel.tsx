"use client";

import { useActionState, useState, useTransition } from "react";
import { cancelBatch, removeFromQueueAction, retryFailedMessages, type WhatsAppActionState } from "@/app/whatsapp/actions";
import { RecipientPicker } from "@/app/whatsapp/recipient-picker";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { EmptyState } from "@/components/admin/empty-state";
import type { BatchProgress, FailedMessage, PendingMessage } from "@/lib/notifications/outbox";
import { cn } from "@/lib/utils";

const initialState: WhatsAppActionState = { status: "idle" };

// The timezone is pinned rather than left to the runtime. Without it the server
// formats in UTC and the browser in IST, the two strings differ, and React
// throws a hydration mismatch. Pinning to Asia/Kolkata makes both agree *and*
// shows the time the office actually works in.
function formatDateTime(value: Date | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function ProgressBar({ batch }: { batch: BatchProgress }) {
  const done = batch.sent + batch.failed + batch.cancelled;
  const percent = batch.total === 0 ? 0 : Math.round((done / batch.total) * 100);

  return (
    <div className="space-y-1.5">
      <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-text-secondary">
        {batch.sent} sent
        {batch.failed > 0 ? ` · ${batch.failed} failed` : ""}
        {batch.cancelled > 0 ? ` · ${batch.cancelled} cancelled` : ""} · {batch.pending + batch.sending}{" "}
        waiting · {batch.total} total
      </p>
    </div>
  );
}

const TEMPLATE_LABEL: Record<string, string> = {
  monthly_bill_v1: "Monthly bill",
  monthly_bill_link_v1: "Monthly bill",
  payment_reminder_hi_en_v1: "Payment reminder",
};

// Messages queued but not yet picked up for sending: the window to take someone
// off. Untick to keep, leave ticked to remove, and "Remove" cancels the ticked
// ones. A message the sender has already picked up can't be recalled, and the
// result says so rather than pretending.
function WaitingQueue({ canSend, waiting }: { canSend: boolean; waiting: PendingMessage[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<WhatsAppActionState>(initialState);
  const [pending, startTransition] = useTransition();

  if (waiting.length === 0) return null;

  const remove = () =>
    startTransition(async () => {
      setResult(await removeFromQueueAction([...selected]));
      setSelected(new Set());
    });

  return (
    <div className="rounded-lg border border-surface-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-text-primary">Waiting to send ({waiting.length})</h2>
      <p className="mt-0.5 text-sm text-text-secondary">
        Tick anyone you want to take off the queue, then press Remove. Messages already picked up for sending can&apos;t be recalled.
      </p>
      <div className="mt-3">
        <RecipientPicker
          rows={waiting.map((message) => ({
            id: message.id,
            code: message.customerCode,
            name: message.customerName,
            detail: TEMPLATE_LABEL[message.template] ?? message.template,
          }))}
          selected={selected}
          onChange={setSelected}
          disabled={pending || !canSend}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <PrimaryButton type="button" onClick={remove} disabled={!canSend || pending || selected.size === 0}>
          {pending ? "Removing…" : `Remove ${selected.size} from queue`}
        </PrimaryButton>
        {result.status !== "idle" && result.message ? (
          <p className={result.status === "error" ? "text-sm text-status-danger-text" : "text-sm text-status-success-text"}>
            {result.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function OutboxPanel({
  canSend,
  batches,
  failed,
  waiting,
}: {
  canSend: boolean;
  batches: BatchProgress[];
  failed: FailedMessage[];
  waiting: PendingMessage[];
}) {
  const [retryState, retryAction, retrying] = useActionState(retryFailedMessages, initialState);
  const [cancelState, cancelAction, cancelling] = useActionState(cancelBatch, initialState);

  if (batches.length === 0) {
    return <EmptyState message="Nothing has been queued yet. Use the Send bills or Reminders tab to start." />;
  }

  return (
    <div className="space-y-4">
      <WaitingQueue canSend={canSend} waiting={waiting} />

      {[retryState, cancelState].map((state, index) =>
        state.status !== "idle" && state.message ? (
          <p
            key={index}
            className={state.status === "error" ? "text-sm text-status-danger-text" : "text-sm text-status-success-text"}
          >
            {state.message}
          </p>
        ) : null,
      )}

      <div className="space-y-3">
        {batches.map((batch) => {
          const active = batch.pending + batch.sending > 0;

          return (
            <div key={batch.batchId} className="rounded-lg border border-surface-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-text-primary">
                    {TEMPLATE_LABEL[batch.template] ? `${TEMPLATE_LABEL[batch.template]}s` : batch.template}
                  </p>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    Queued {formatDateTime(batch.createdAt)}
                    {batch.lastSentAt ? ` · last sent ${formatDateTime(batch.lastSentAt)}` : ""}
                  </p>
                </div>

                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-semibold",
                    active
                      ? "bg-accent-soft text-accent-soft-text"
                      : "bg-surface-muted text-text-secondary",
                  )}
                >
                  {active ? "Sending" : "Finished"}
                </span>
              </div>

              <div className="mt-3">
                <ProgressBar batch={batch} />
              </div>

              {active && canSend ? (
                <form action={cancelAction} className="mt-3">
                  <input type="hidden" name="batchId" value={batch.batchId} />
                  <SecondaryButton type="submit" disabled={cancelling}>
                    {cancelling ? "Cancelling…" : "Stop sending the rest"}
                  </SecondaryButton>
                </form>
              ) : null}
            </div>
          );
        })}
      </div>

      {failed.length > 0 ? (
        <div className="rounded-lg border border-surface-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Failed ({failed.length})</h2>
              <p className="mt-0.5 text-sm text-text-secondary">
                These were not delivered. Fix the underlying problem — usually the customer&apos;s number
                — before retrying.
              </p>
            </div>

            {canSend ? (
              <form action={retryAction}>
                <SecondaryButton type="submit" disabled={retrying}>
                  {retrying ? "Requeueing…" : "Retry all"}
                </SecondaryButton>
              </form>
            ) : null}
          </div>

          <ul className="mt-3 divide-y divide-surface-border text-sm">
            {failed.map((message) => (
              <li key={message.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="text-text-primary">
                  {message.customerCode} · {message.customerName}
                </span>
                <span className="text-xs text-text-secondary">
                  {message.recipient} · {message.attempts} attempt{message.attempts === 1 ? "" : "s"} ·{" "}
                  {message.lastError ?? "Unknown error"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
