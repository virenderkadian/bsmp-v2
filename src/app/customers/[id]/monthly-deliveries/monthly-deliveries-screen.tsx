"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CustomerSwitcher } from "@/app/customers/[id]/monthly-deliveries/customer-switcher";
import {
  revertCustomerMonthBillToDraft,
  saveCustomerMonthEntries,
} from "@/app/customers/[id]/monthly-deliveries/actions";
import type { DailyEntryActionState } from "@/app/daily-entry/actions";
import { DoorstepPaymentDialog } from "@/app/daily-entry/doorstep-payment-dialog";
import { PaymentEditDialog } from "@/app/customers/[id]/monthly-deliveries/payment-edit-dialog";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { IconButton } from "@/components/admin/icon-button";
import { PencilSquareIcon, WalletIcon } from "@/components/admin/icons";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { SummaryStatBar, type SummaryStatItem } from "@/components/admin/summary-stat-bar";
import { Toast } from "@/components/admin/toast";
import { useLoadingBar } from "@/components/admin/loading-bar";
import type { CustomerMonthEntriesPayload, CustomerMonthPayment } from "@/lib/customer-month-entries";

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

function formatPaymentDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMoney(value: string) {
  return `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function paymentStatusTone(status: string) {
  if (status === "VERIFIED") return "success" as const;
  if (status === "CANCELLED") return "danger" as const;
  return "warning" as const;
}

// Fixing a customer's disputed entries one date at a time in Daily Entry is
// slow once a bill's already out — this shows every delivery of theirs for a
// month (across whichever routes/shifts served them) and saves every
// correction in one submit. It never touches saveDailyEntry's own save
// path, which rebuilds a whole route+date's lines and would wipe every other
// customer on that route if called with just one customer's data — see
// src/app/customers/[id]/monthly-deliveries/actions.ts for the narrower
// write path this screen actually uses.
export function MonthlyDeliveriesScreen({ payload }: { payload: CustomerMonthEntriesPayload }) {
  const { navigate } = useLoadingBar();
  const router = useRouter();
  const monthInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [state, formAction, pending] = useActionState(saveCustomerMonthEntries, initialState);
  const [revertState, revertAction, revertPending] = useActionState(revertCustomerMonthBillToDraft, initialState);
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [handledKey, setHandledKey] = useState("");
  const [showActions, setShowActions] = useState(false);
  const [doorstepRow, setDoorstepRow] = useState<{ routeId: string; entryDate: string } | null>(null);
  const [editingPayment, setEditingPayment] = useState<CustomerMonthPayment | null>(null);

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

  const goToMonth = (month: string) =>
    navigate(`/customers/${payload.customer?.id ?? ""}/monthly-deliveries?month=${month}`);

  // Fills only the cells still at 0 with this customer's most recent
  // non-zero quantity for that product — never overwrites a typed value, and
  // only runs when asked, same reasoning as Daily Entry's own "Fill usual"
  // (src/app/daily-entry/daily-entry-screen.tsx): nobody should accidentally
  // save an old quantity as a correction just by tabbing past an empty cell.
  const fillUsual = () => {
    const inputs = formRef.current?.querySelectorAll<HTMLInputElement>("[data-monthly-quantity='true']");
    if (!inputs) {
      return;
    }

    let changed = false;
    inputs.forEach((input) => {
      const usual = Number(input.dataset.usualQuantity || "0");
      if (usual > 0 && Number(input.value || 0) === 0) {
        input.value = String(usual);
        changed = true;
      }
    });

    if (changed) {
      setDirty(true);
    }
  };

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
        title={`${payload.customer.name} Monthly Deliveries`}
        subtitle={`${payload.customer.code} · correct any date's quantities and save once for the whole month.`}
        actions={
          <>
            <CustomerSwitcher currentCustomerName={payload.customer.name} month={payload.month} />
            <Link
              href={`/customers/${payload.customer.id}`}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-surface-border-strong bg-surface px-4 text-sm font-medium text-text-secondary transition hover:bg-surface-muted"
            >
              Back to customer
            </Link>
          </>
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

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-secondary transition hover:bg-surface-muted">
              <input
                type="checkbox"
                checked={showActions}
                onChange={(event) => setShowActions(event.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              At the door
            </label>
            <SecondaryButton
              type="button"
              onClick={fillUsual}
              className="h-10 px-4 text-sm font-medium"
              title="Fill every empty cell with what this customer most recently took"
            >
              Fill usual
            </SecondaryButton>
          </div>

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
              ...(showActions ? [{ key: "actions", label: "", className: "w-12" }] : []),
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
                        data-monthly-quantity="true"
                        data-usual-quantity={payload.usualQuantities[product.id] ?? ""}
                        className="h-9 w-20 rounded-md border border-surface-border-strong bg-surface px-2 text-right text-sm tabular-nums outline-none transition focus:border-accent"
                      />
                    </span>
                  );
                }),
                ...(showActions
                  ? [
                      <IconButton
                        key="actions"
                        type="button"
                        title="Collect payment at the door"
                        aria-label="Collect payment at the door"
                        onClick={() => setDoorstepRow({ routeId: line.routeId, entryDate: line.entryDate })}
                      >
                        <WalletIcon className="h-[18px] w-[18px]" />
                      </IconButton>,
                    ]
                  : []),
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

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-primary">Payments this month</h2>
        <DataTable
          columns={["Date", "Amount", "Mode", "Status", "Reference", ""]}
          emptyMessage={`No payments recorded from ${payload.customer.name} in ${formatMonthLabel(payload.month)}.`}
          rows={payload.payments.map((payment) => ({
            key: payment.id,
            cells: [
              formatPaymentDate(payment.paymentDate),
              formatMoney(payment.amount),
              payment.mode,
              <StatusBadge key="status" tone={paymentStatusTone(payment.status)}>
                {payment.status}
              </StatusBadge>,
              payment.referenceNo || payment.notes || "—",
              <IconButton
                key="edit"
                type="button"
                title="Edit this payment"
                aria-label="Edit this payment"
                onClick={() => setEditingPayment(payment)}
              >
                <PencilSquareIcon className="h-[18px] w-[18px]" />
              </IconButton>,
            ],
          }))}
        />
      </section>

      {editingPayment ? (
        <PaymentEditDialog
          payment={editingPayment}
          customerId={payload.customer.id}
          onClose={() => setEditingPayment(null)}
          onSaved={(message) => {
            setEditingPayment(null);
            setToast({ tone: "success", message });
            router.refresh();
          }}
        />
      ) : null}

      <DoorstepPaymentDialog
        target={
          doorstepRow && payload.customer
            ? { customerId: payload.customer.id, customerName: payload.customer.name, customerCode: payload.customer.code }
            : null
        }
        routeId={doorstepRow?.routeId ?? ""}
        paymentDate={doorstepRow?.entryDate ?? `${payload.month}-01`}
        onClose={() => setDoorstepRow(null)}
        onRecorded={(message) => {
          setDoorstepRow(null);
          setToast({ tone: "success", message });
        }}
      />

      {toast ? <Toast tone={toast.tone}>{toast.message}</Toast> : null}
    </div>
  );
}
