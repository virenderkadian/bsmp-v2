"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  revertCustomerMonthBillToDraft,
  saveCustomerMonthEntries,
} from "@/app/customers/[id]/daily-entries/actions";
import type { DailyEntryActionState } from "@/app/daily-entry/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { IconButton } from "@/components/admin/icon-button";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { SummaryStatBar, type SummaryStatItem } from "@/components/admin/summary-stat-bar";
import { Toast } from "@/components/admin/toast";
import { useLoadingBar } from "@/components/admin/loading-bar";
import type { CustomerMonthEntriesPayload } from "@/lib/customer-month-entries";

const initialState: DailyEntryActionState = { status: "idle" };

function formatDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    weekday: "short",
  });
}

function formatMonthLabel(month: string) {
  return new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function addMonths(month: string, delta: number) {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftLabel(shift: string) {
  return shift === "EVENING" ? "Evening" : "Morning";
}

// Fixing a customer's disputed entries one date at a time in Daily Entry is
// slow once a bill's already out — this shows every delivery of theirs for a
// month (across whichever routes/shifts served them) and saves every
// correction in one submit. It never touches saveDailyEntry's own save
// path, which rebuilds a whole route+date's lines and would wipe every other
// customer on that route if called with just one customer's data — see
// src/app/customers/[id]/daily-entries/actions.ts for the narrower write
// path this screen actually uses.
export function CustomerMonthEntriesScreen({ payload }: { payload: CustomerMonthEntriesPayload }) {
  const { navigate } = useLoadingBar();
  const monthInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [state, formAction, pending] = useActionState(saveCustomerMonthEntries, initialState);
  const [revertState, revertAction, revertPending] = useActionState(revertCustomerMonthBillToDraft, initialState);
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [handledKey, setHandledKey] = useState("");

  const resultKey = `${state.status}:${state.message ?? ""}|${revertState.status}:${revertState.message ?? ""}`;
  if (resultKey !== handledKey) {
    setHandledKey(resultKey);
    const latest = revertState.status !== "idle" ? revertState : state;
    if (latest.status !== "idle" && latest.message) {
      setToast({ tone: latest.status === "success" ? "success" : "error", message: latest.message });
      if (latest.status === "success") {
        setDirty(false);
      }
    }
  }

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const goToMonth = (month: string) => navigate(`/customers/${payload.customer?.id ?? ""}/daily-entries?month=${month}`);

  if (!payload.dbConnected || !payload.customer) {
    return <EmptyState message={payload.error ?? "Unable to load this customer's month."} />;
  }

  const unlockedLines = payload.lines.filter((line) => !line.billLocked);
  const lockedLines = payload.lines.filter((line) => line.billLocked);
  const showRevertBanner = state.blockedByBill === true && revertState.status !== "success";

  const stats: SummaryStatItem[] = [
    { key: "dates", label: "Dates delivered", value: String(payload.lines.length) },
    ...(lockedLines.length > 0
      ? [{ key: "locked", label: "Locked / Generated", value: String(lockedLines.length), tone: "danger" as const }]
      : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${payload.customer.name} — deliveries`}
        subtitle={`${payload.customer.code} · correct any date's quantities and save once for the whole month.`}
        actions={
          <Link
            href={`/customers/${payload.customer.id}`}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-surface-border-strong bg-surface px-4 text-sm font-medium text-text-secondary transition hover:bg-surface-muted"
          >
            Back to customer
          </Link>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <IconButton
            type="button"
            title="Previous month"
            aria-label="Previous month"
            onClick={() => goToMonth(addMonths(payload.month, -1))}
            className="border border-surface-border-strong bg-surface text-text-primary shadow-sm hover:border-accent hover:bg-surface-muted"
          >
            ‹
          </IconButton>
          <div className="relative inline-flex h-8 min-w-[170px] items-center justify-center rounded-md border border-surface-border-strong bg-surface px-3 shadow-sm transition hover:border-accent hover:bg-surface-muted">
            <span className="pointer-events-none select-none text-sm font-semibold text-text-primary">
              {formatMonthLabel(payload.month)}
            </span>
            <input
              ref={monthInputRef}
              type="month"
              value={payload.month}
              onChange={(event) => event.target.value && goToMonth(event.target.value)}
              onClick={(event) => event.currentTarget.showPicker?.()}
              aria-label="Pick a month"
              title="Pick a month"
              className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
            />
          </div>
          <IconButton
            type="button"
            title="Next month"
            aria-label="Next month"
            onClick={() => goToMonth(addMonths(payload.month, 1))}
            className="border border-surface-border-strong bg-surface text-text-primary shadow-sm hover:border-accent hover:bg-surface-muted"
          >
            ›
          </IconButton>
        </div>

        {payload.lines.length > 0 ? <SummaryStatBar stats={stats} /> : null}
      </div>

      {payload.possiblyArchived ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Nothing found for {formatMonthLabel(payload.month)}, and this city has an archived month on file for this
          period — this customer&rsquo;s deliveries may have been moved out of the live database. Restore it from
          Settings → Archive to view or edit it here.
        </div>
      ) : null}

      {showRevertBanner ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="flex-1">{state.message}</span>
          <form action={revertAction}>
            <input type="hidden" name="customerId" value={payload.customer.id} readOnly />
            <input type="hidden" name="month" value={payload.month} readOnly />
            <SecondaryButton type="submit" disabled={revertPending} className="h-9 px-4 text-sm font-medium">
              {revertPending ? "Reverting..." : "Revert bill to Draft"}
            </SecondaryButton>
          </form>
        </div>
      ) : null}

      {payload.lines.length === 0 && !payload.possiblyArchived ? (
        <EmptyState message={`No deliveries recorded for ${payload.customer.name} in ${formatMonthLabel(payload.month)}.`} />
      ) : (
        <form
          ref={formRef}
          action={formAction}
          onChange={() => setDirty(true)}
          className="space-y-4"
        >
          <input type="hidden" name="customerId" value={payload.customer.id} readOnly />
          <input type="hidden" name="month" value={payload.month} readOnly />

          <DataTable
            columns={[
              { key: "date", label: "Date", className: "whitespace-nowrap" },
              { key: "route", label: "Route", className: "whitespace-nowrap" },
              { key: "status", label: "Bill", className: "whitespace-nowrap" },
              ...payload.products.map((product) => ({
                key: product.id,
                label: product.shortName ?? product.name,
                className: "text-right whitespace-nowrap",
                headerClassName: "text-right",
              })),
            ]}
            rows={payload.lines.map((line) => ({
              key: line.lineId,
              cells: [
                <span key="date" className="font-medium text-text-primary">
                  {!line.billLocked ? (
                    <input type="hidden" name="lineId" value={line.lineId} readOnly />
                  ) : null}
                  {formatDate(line.entryDate)}
                </span>,
                <span key="route" className="text-text-secondary">
                  {line.routeCode} · {shiftLabel(line.shift)}
                </span>,
                <StatusBadge key="status" tone={line.billLocked ? "danger" : "neutral"}>
                  {line.billStatus ?? "Draft"}
                </StatusBadge>,
                ...payload.products.map((product) => {
                  const value = line.quantities[product.id];
                  if (line.billLocked) {
                    return (
                      <span key={product.id} className="block text-right tabular-nums text-text-secondary">
                        {value ?? "—"}
                      </span>
                    );
                  }
                  // The hidden productId/productLineId pair travels right
                  // alongside its quantity input — formData.getAll() returns
                  // values in document order per field name, and the server
                  // action zips these three arrays together by index, so
                  // they have to stay adjacent rather than being emitted in
                  // a separate block elsewhere in the form.
                  return (
                    <span key={product.id} className="inline-flex justify-end">
                      <input type="hidden" name="productId" value={product.id} readOnly />
                      <input type="hidden" name="productLineId" value={line.lineId} readOnly />
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        name="quantity"
                        defaultValue={value ?? ""}
                        placeholder="0"
                        className="h-9 w-20 rounded-md border border-surface-border-strong bg-surface px-2 text-right text-sm tabular-nums outline-none transition focus:border-accent"
                      />
                    </span>
                  );
                }),
              ],
            }))}
          />

          <div className="flex justify-end">
            <PrimaryButton type="submit" disabled={!dirty || pending || unlockedLines.length === 0}>
              {pending ? "Saving..." : "Save changes"}
            </PrimaryButton>
          </div>
        </form>
      )}

      {toast ? <Toast tone={toast.tone}>{toast.message}</Toast> : null}
    </div>
  );
}
