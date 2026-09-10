"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import {
  generateMonthlyBills,
  type MonthlyBillActionState,
  updateMonthlyBillStatus,
} from "@/app/monthly-bills/actions";
import { MonthlyBillSummaryControls } from "@/app/monthly-bills/monthly-bill-summary-controls";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { DataTable } from "@/components/admin/data-table";
import { Dialog } from "@/components/admin/dialog";
import { EmptyState } from "@/components/admin/empty-state";
import { FormInput } from "@/components/admin/form-input";
import { BillIcon, ViewIcon } from "@/components/admin/icons";
import { KeyboardForm } from "@/components/admin/keyboard-form";
import { MasterTabs } from "@/components/admin/master-tabs";
import { FilterButton, FilterChip, FilterPanel } from "@/components/admin/filter-panel";
import {
  billFiltersToParams,
  hasActiveBillFilters,
  matchesBillFilters,
  sumBillRows,
  withinAmountRange,
  type BillAmountField,
  type BillFilters,
} from "@/lib/bill-filters";
import { PageActions } from "@/components/admin/page-actions";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";
import { StatusBadge } from "@/components/admin/status-badge";
import { SummaryStatBar } from "@/components/admin/summary-stat-bar";
import type {
  MonthlyBillPayload,
  MonthlyBillSummaryPayload,
} from "@/lib/monthly-bills";

const initialState: MonthlyBillActionState = { status: "idle" };

// A real window name, not "_blank" — "_blank" is a magic keyword meaning
// "always open a brand-new browsing context," so every click spawned
// another tab regardless of one already being open. A stable name makes
// the browser reuse/navigate the same window on repeat clicks instead —
// but only without "noopener": that flag forces the new window into a
// disconnected browsing-context group, which breaks the spec's name-based
// window-reuse lookup entirely (it only searches the opener's *related*
// contexts). Safe to drop here since both print targets are same-origin
// routes within this app, not third-party links.
const PRINT_WINDOW_NAME = "bsm-print-preview";

function formatMonthInput(value: Date) {
  return new Date(value).toISOString().slice(0, 7);
}

function formatMonth(value: Date) {
  return new Date(value).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
}

function formatSnapshot(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMoney(value: string | number) {
  return `₹${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatQty(value: string) {
  const quantity = Number(value);

  return quantity === 0 ? "-" : quantity.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function statusTone(status: string) {
  if (status === "LOCKED") {
    return "success" as const;
  }

  if (status === "CANCELLED") {
    return "danger" as const;
  }

  if (status === "GENERATED") {
    return "info" as const;
  }

  return "warning" as const;
}

function statusLabel(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function getDefaultNextStatus(status: string) {
  if (status === "DRAFT") {
    return "GENERATED";
  }

  if (status === "GENERATED") {
    return "LOCKED";
  }

  if (status === "LOCKED") {
    return "GENERATED";
  }

  return "DRAFT";
}

function PrintSummaryDialog({
  open,
  routes,
  defaultMonth,
  onClose,
}: {
  open: boolean;
  routes: MonthlyBillPayload["routes"];
  defaultMonth: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Print route summary"
      description="Generate a printable customer-wise bill summary in monthly route sequence order."
      footer={null}
    >
      <MonthlyBillSummaryControls routes={routes} defaultMonth={defaultMonth} />
    </Dialog>
  );
}

function getPreviousMonth(monthValue: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthValue);
  if (!match) {
    return "";
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const prev = new Date(Date.UTC(year, month - 2, 1));
  return prev.toISOString().slice(0, 7);
}

function GenerateBillsDialog({
  open,
  dbConnected,
  defaultMonth,
  unlockedMonths,
  onClose,
}: {
  open: boolean;
  dbConnected: boolean;
  defaultMonth: string;
  unlockedMonths: Set<string>;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(generateMonthlyBills, initialState);
  const [billingMonth, setBillingMonth] = useState(defaultMonth);

  useEffect(() => {
    if (!open || state.status !== "success") {
      return;
    }

    // Give the user a moment to read messages like "N locked bills left
    // unchanged" before the dialog disappears.
    if (state.message && state.message.includes("locked")) {
      const timer = setTimeout(onClose, 1800);
      return () => clearTimeout(timer);
    }

    onClose();
  }, [onClose, open, state.status, state.message]);

  // Carry-forward opening balances come from the previous month's CLOSING. If
  // that month still has unlocked bills, its closings can still move, so this
  // month's openings aren't final yet. Warn — but allow (they can regenerate).
  const previousMonth = getPreviousMonth(billingMonth);
  const previousMonthUnlocked = previousMonth !== "" && unlockedMonths.has(previousMonth);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Generate monthly bills"
      description="Build customer-route bills from saved Daily Entry rows and verified payments."
      footer={null}
    >
      <KeyboardForm action={action} className="space-y-4">
        <FormInput
          label="Billing month"
          name="billingMonth"
          type="month"
          value={billingMonth}
          onChange={(event) => setBillingMonth(event.target.value)}
          autoFocus
        />
        <div className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-text-secondary">
          This will create or refresh bill snapshots for the selected month. Existing generated
          bills for the same customer-route-month will be updated.
        </div>
        {previousMonthUnlocked ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            The previous month ({formatMonth(new Date(`${previousMonth}-01T00:00:00.000Z`))}) still has
            bills that aren&apos;t Locked. Its closing balances — which carry forward as this month&apos;s
            opening — may still change. You can generate now and regenerate later once it&apos;s locked.
          </div>
        ) : null}
        {state.status !== "idle" && state.message ? (
          <p className={state.status === "success" ? "text-sm text-emerald-700" : "text-sm text-rose-700"}>
            {state.message}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-surface-border pt-4">
          <StatusBadge tone={dbConnected ? "success" : "warning"}>
            {dbConnected ? "Live data" : "Offline fallback"}
          </StatusBadge>
          <SecondaryButton type="button" onClick={onClose} disabled={pending}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={pending}>
            {pending ? "Generating..." : "Generate bills"}
          </PrimaryButton>
        </div>
      </KeyboardForm>
    </Dialog>
  );
}

function BillStatusButton({
  billId,
  status,
  contextLine,
  statuses,
}: {
  billId: string;
  status: string;
  contextLine: React.ReactNode;
  statuses: MonthlyBillPayload["statuses"];
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [nextStatus, setNextStatus] = useState(getDefaultNextStatus(status));
  const [state, action, pending] = useActionState(async (prevState: MonthlyBillActionState, formData: FormData) => {
    const result = await updateMonthlyBillStatus(prevState, formData);

    if (result.status === "success") {
      setConfirmOpen(false);
      setSubmitted(false);
    }

    return result;
  }, initialState);

  const openConfirm = () => {
    setNextStatus(getDefaultNextStatus(status));
    setSubmitted(false);
    setConfirmOpen(true);
  };

  const closeConfirm = () => {
    if (!pending) {
      setConfirmOpen(false);
      setSubmitted(false);
    }
  };

  // Reverting a Generated/Locked bill to Draft is how a customer's bill is
  // re-opened for editing (Daily Entry unblocks once no bill on that route +
  // month is Generated/Locked).
  const hint =
    nextStatus === "DRAFT" && status !== "DRAFT"
      ? "Reverting to Draft re-opens this bill for editing and returns its collections to the open balance."
      : nextStatus === "LOCKED"
      ? "Locking freezes the amount collected so far into this statement."
      : null;

  return (
    <>
      <button type="button" onClick={openConfirm} className="rounded-full text-left" title="Change bill status">
        <StatusBadge tone={statusTone(status)}>{statusLabel(status)}</StatusBadge>
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Change bill status?"
        description="Update this monthly bill after review or approval."
        confirmLabel="Update status"
        pending={pending}
        onClose={closeConfirm}
        action={action}
        onSubmit={() => setSubmitted(true)}
      >
        <input type="hidden" name="id" value={billId} />
        <SelectInput
          label="New status"
          name="status"
          value={nextStatus}
          onChange={(event) => setNextStatus(event.target.value)}
          options={statuses}
        />
        <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-text-secondary">{contextLine}</p>
        {hint ? <p className="text-xs text-text-secondary">{hint}</p> : null}
        {submitted && state.status === "error" && state.message ? (
          <p className="text-sm font-medium text-rose-700">{state.message}</p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

// Blank on either side means unbounded, so "min only" and "max only" both
// work rather than requiring a full range.
function CustomerSummaryTab({
  summaryPayload,
  statuses,
  status,
  search,
  amountField,
  minAmount,
  maxAmount,
}: {
  summaryPayload: MonthlyBillSummaryPayload;
  statuses: MonthlyBillPayload["statuses"];
  status: string;
  search: string;
  amountField: BillAmountField;
  minAmount: string;
  maxAmount: string;
}) {
  const { selectedMonth } = summaryPayload;
  // Every filter applies on both tabs, so the panel holds the same controls
  // whichever one is open. A customer with no bill yet has a null status, so
  // filtering by status correctly excludes them rather than lumping them in
  // with Draft.
  // The identical rule the print route runs — see src/lib/bill-filters.ts.
  // pendingAmount is the Summary's name for what the Bills tab calls the
  // closing balance, so one control drives both.
  const filters: BillFilters = { status, search, amountField, minAmount, maxAmount };
  // The same filters, encoded for the print route so the paper matches the screen.
  const summaryFilterQuery = billFiltersToParams(filters).toString();
  const routes = useMemo(() => {
    const filtered = hasActiveBillFilters(filters);

    return summaryPayload.routes.map((route) => {
      const rows = route.rows.filter((row) => matchesBillFilters(row, filters));
      // A Route Total that doesn't add up to the rows above it reads as a bug,
      // so once a filter hides a row the total is recomputed from what is left.
      return { ...route, rows, totals: filtered ? sumBillRows(rows) : route.totals };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountField, maxAmount, minAmount, search, status, summaryPayload.routes]);

  return (
    <div className="space-y-4">
      {summaryPayload.error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {summaryPayload.error}
        </div>
      ) : null}

      {/* Generated bills freeze their amounts, so deliveries entered afterwards
          don't show here until the month is regenerated. Without saying so the
          screen presents a snapshot exactly like live data — someone checking
          mid-month has no way to tell they're reading stale figures. */}
      {summaryPayload.figuresAsOf ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">Figures as of {formatSnapshot(summaryPayload.figuresAsOf)}.</span>{" "}
          These come from bills already generated for this month, so anything delivered since
          isn&apos;t included. Regenerate the month to bring them up to date.
        </div>
      ) : null}

      {routes.length === 0 ? (
        <EmptyState message="No active routes found for this selection." />
      ) : (
        routes.map((route) => (
          <section key={route.id} className="rounded-lg border border-surface-border bg-surface shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-surface-border bg-surface-muted px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  {route.code} - {route.name}
                </h3>
                <p className="mt-0.5 text-xs text-text-secondary">
                  {route.shift === "MORNING" ? "Morning" : "Evening"} · {route.rows.length} customers
                </p>
              </div>
              <button
                type="button"
                disabled={route.rows.length === 0}
                onClick={() => {
                  window.open(
                    `/monthly-bills/summary?month=${selectedMonth}&routeId=${route.id}${
                      summaryFilterQuery ? `&${summaryFilterQuery}` : ""
                    }`,
                    PRINT_WINDOW_NAME,
                  );
                }}
                title="Print this route's summary"
                aria-label={`Print summary for ${route.name}`}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-secondary transition hover:bg-slate-200 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <BillIcon className="h-[18px] w-[18px]" />
              </button>
            </div>

            {route.rows.length === 0 ? (
              <div className="px-4 py-6">
                <EmptyState message="No monthly sequence customers found for this route and month." />
              </div>
            ) : (
              <DataTable
                columns={[
                  { key: "sr", label: "Sr", className: "w-14" },
                  { key: "customer", label: "Customer" },
                  ...summaryPayload.products.map((product) => ({
                    key: product.id,
                    label: product.shortName ?? product.code,
                    className: "w-24 text-right",
                    headerClassName: "text-right",
                  })),
                  { key: "amount", label: "Amount", className: "w-32 text-right", headerClassName: "text-right" },
                  { key: "received", label: "Received", className: "w-32 text-right", headerClassName: "text-right" },
                  { key: "pending", label: "Pending", className: "w-32 text-right", headerClassName: "text-right" },
                  { key: "actions", label: "Actions", className: "w-28 text-right print:hidden", headerClassName: "text-right print:hidden" },
                ]}
                rows={[
                  ...route.rows.map((row) => ({
                    key: row.key,
                    cells: [
                      row.sequenceNo,
                      <div key="customer" className="min-w-[200px] truncate">
                        <span className="font-medium text-text-primary">{row.customerName}</span>
                        {/* Removed from the sequence mid-month but still has
                            deliveries, so they're still billed for them. Shown
                            here so that can't happen invisibly. */}
                        {row.inSequence ? null : (
                          <span className="ml-2 whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                            Removed
                          </span>
                        )}
                      </div>,
                      ...summaryPayload.products.map((product) => (
                        <span key={product.id} className="block text-right">
                          {formatQty(row.productQuantities[product.id] ?? "0")}
                        </span>
                      )),
                      <span key="amount" className="block text-right font-medium text-text-primary">
                        {formatMoney(row.deliveryAmount)}
                      </span>,
                      <span key="received" className="block text-right text-emerald-700">
                        {formatMoney(row.paymentAmount)}
                      </span>,
                      <span key="pending" className="block text-right font-semibold text-rose-700">
                        {formatMoney(row.pendingAmount)}
                      </span>,
                      <div key="actions" className="flex items-center justify-end gap-1.5">
                        {row.billId && row.status ? (
                          <>
                            <BillStatusButton
                              billId={row.billId}
                              status={row.status}
                              statuses={statuses}
                              contextLine={
                                <>
                                  <span className="font-semibold text-text-primary">{row.customerName}</span> ·{" "}
                                  {route.code} - {route.name} · {formatMoney(row.pendingAmount)}
                                </>
                              }
                            />
                            <Link
                              href={`/monthly-bills/${row.billId}`}
                              aria-label={`View bill for ${row.customerName}`}
                              title="View bill"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-primary transition hover:bg-surface-muted"
                            >
                              <ViewIcon className="h-[18px] w-[18px]" />
                              <span className="sr-only">View bill</span>
                            </Link>
                          </>
                        ) : (
                          <span
                            className="text-xs text-text-muted"
                            title="Generate bills for this route and month to change this customer's bill status"
                          >
                            Not generated
                          </span>
                        )}
                      </div>,
                    ],
                  })),
                  {
                    key: "totals",
                    className: "bg-surface-muted font-semibold",
                    cells: [
                      "",
                      <span key="label" className="font-semibold text-text-primary">
                        Route Total
                      </span>,
                      ...summaryPayload.products.map((product) => (
                        <span key={product.id} className="block text-right text-text-primary">
                          {formatQty(route.totals.productQuantities[product.id] ?? "0")}
                        </span>
                      )),
                      <span key="amount" className="block text-right text-text-primary">
                        {formatMoney(route.totals.deliveryAmount)}
                      </span>,
                      <span key="received" className="block text-right text-emerald-700">
                        {formatMoney(route.totals.paymentAmount)}
                      </span>,
                      <span key="pending" className="block text-right text-rose-700">
                        {formatMoney(route.totals.pendingAmount)}
                      </span>,
                      "",
                    ],
                  },
                ]}
                emptyMessage="No customers found"
                minWidth="min-w-[900px]"
                className="rounded-none border-0 shadow-none"
                headClassName="bg-surface-muted"
                headerCellClassName="px-4 py-2.5"
                rowClassName="align-middle hover:bg-surface-muted/60"
                cellClassName="px-4 py-2.5"
              />
            )}
          </section>
        ))
      )}

      {/* Customers carrying a balance who have no bill this month — off every
          route, no deliveries. They'd otherwise vanish from this screen while
          still owing money, so they're listed separately rather than mixed in
          with the routes they're no longer on. */}
      {summaryPayload.outstanding.length > 0 ? (
        <section className="rounded-lg border border-amber-300 bg-surface shadow-sm">
          <div className="border-b border-amber-300 bg-amber-50 px-4 py-3">
            <h3 className="text-sm font-semibold text-amber-900">
              Outstanding · not on any route this month
            </h3>
            <p className="mt-0.5 text-xs text-amber-800">
              {summaryPayload.outstanding.length} customer
              {summaryPayload.outstanding.length === 1 ? "" : "s"} still carrying a balance from an
              earlier month. They get no bill this month, so collect against their last one.
            </p>
          </div>
          <ul className="divide-y divide-surface-border">
            {summaryPayload.outstanding.map((row) => (
              <li key={row.customerId} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="text-sm font-medium text-text-primary">{row.customerName}</span>
                  <span className="ml-2 text-xs text-text-muted">
                    {row.customerCode}
                    {row.customerMobile ? ` · ${row.customerMobile}` : ""}
                    {row.lastBilledMonth ? ` · last billed ${row.lastBilledMonth}` : ""}
                  </span>
                </span>
                <span
                  className={
                    Number(row.outstandingAmount) < 0
                      ? "text-sm font-semibold text-emerald-700"
                      : "text-sm font-semibold text-rose-700"
                  }
                >
                  {formatMoney(row.outstandingAmount)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function MonthlyBillScreen({
  payload,
  summaryPayload,
}: {
  payload: MonthlyBillPayload;
  summaryPayload: MonthlyBillSummaryPayload;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"summary" | "bills">("summary");
  // Both tabs default to the previous month (the one we're actually billing and
  // collecting on) — the server resolves it into summaryPayload.selectedMonth.
  const defaultMonth = summaryPayload.selectedMonth;
  const [search, setSearch] = useState("");
  // Which money column the min/max applies to. "Bills over 5,000" means
  // something different for each: closing balance is what is still owed (the
  // chase-the-money view), delivery amount is the month's milk (the
  // spot-an-anomaly view).
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [amountField, setAmountField] = useState<BillAmountField>("closingBalance");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [routeId, setRouteId] = useState("");
  const [status, setStatus] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [printSummaryOpen, setPrintSummaryOpen] = useState(false);

  const { selectedMonth: summaryMonth, selectedRouteId: summaryRouteId } = summaryPayload;
  const goToSummary = useCallback(
    (nextMonth: string, nextRouteId: string) => {
      const params = new URLSearchParams();
      params.set("month", nextMonth);
      if (nextRouteId) {
        params.set("routeId", nextRouteId);
      }
      router.push(`/monthly-bills?${params.toString()}`);
    },
    [router],
  );
  // Print URLs carry the filters. These are separate server routes, so
  // whatever is not in the URL is simply not applied — which is why a filtered
  // screen used to print the whole month.
  const printFilterQuery = billFiltersToParams({
    status,
    search,
    amountField,
    minAmount,
    maxAmount,
  }).toString();
  const printAllHref = summaryRouteId
    ? `/monthly-bills/print-all?month=${summaryMonth}&routeId=${summaryRouteId}${
        printFilterQuery ? `&${printFilterQuery}` : ""
      }`
    : null;

  // Months (YYYY-MM) that still have at least one non-final bill (Draft or
  // Generated). Used to warn when generating a month whose prior month isn't
  // fully locked yet — its carried-forward closings can still move.
  const unlockedMonths = useMemo(() => {
    const months = new Set<string>();
    payload.bills.forEach((bill) => {
      if (bill.status === "DRAFT" || bill.status === "GENERATED") {
        months.add(formatMonthInput(bill.billingMonth));
      }
    });
    return months;
  }, [payload.bills]);

  const filteredBills = useMemo(() => {
    return payload.bills.filter((bill) => {
      const query = search.toLowerCase().trim();
      const matchesSearch =
        query === "" ||
        bill.customerCode.toLowerCase().includes(query) ||
        bill.customerName.toLowerCase().includes(query) ||
        bill.routeCode.toLowerCase().includes(query) ||
        bill.routeName.toLowerCase().includes(query) ||
        bill.itemSummary.toLowerCase().includes(query);
      const matchesRoute = routeId === "" || bill.routeId === routeId;
      const matchesStatus = status === "" || bill.status === status;

      // Same rule as the Summary tab, so the one control cannot mean two
      // different things depending on which tab is open.
      const amount = Number(amountField === "closingBalance" ? bill.closingBalance : bill.deliveryAmount);
      const matchesAmount = withinAmountRange(amount, minAmount, maxAmount);

      return matchesSearch && matchesRoute && matchesStatus && matchesAmount;
    });
  }, [amountField, maxAmount, minAmount, payload.bills, routeId, search, status]);

  const totals = useMemo(() => {
    return filteredBills.reduce(
      (current, bill) => {
        current.delivery += Number(bill.deliveryAmount);
        current.payments += Number(bill.paymentAmount);
        current.closing += Number(bill.closingBalance);

        if (bill.status === "LOCKED") {
          current.locked += 1;
        }

        return current;
      },
      { delivery: 0, payments: 0, closing: 0, locked: 0 },
    );
  }, [filteredBills]);


  const resetFilters = () => {
    setSearch("");
    setStatus("");
    setMinAmount("");
    setMaxAmount("");
    // Route goes through the shared handler, which navigates on the Summary
    // tab rather than only setting local state.
    onFilterRouteChange("");
  };

  // Month/route are shared by both tabs, but the mechanisms differ: the
  // Summary tab is server-driven (navigate to reload), the Bills tab filters
  // the already-loaded list client-side. One filter bar, handlers switch on
  // the active tab.
  const isSummary = activeTab === "summary";
  const filterMonth = isSummary ? summaryMonth : payload.selectedMonth;
  const filterRouteId = isSummary ? summaryRouteId : routeId;
  // Both tabs reload on a month change now. The Bills tab used to filter an
  // already-loaded list of every bill ever written; it fetches one month at a
  // time instead, so the month has to reach the server.
  const onFilterMonthChange = (value: string) => {
    goToSummary(value, isSummary ? summaryRouteId : routeId);
  };
  const onFilterRouteChange = useCallback(
    (value: string) => {
      if (isSummary) {
        goToSummary(summaryMonth, value);
      } else {
        setRouteId(value);
      }
    },
    [goToSummary, isSummary, summaryMonth],
  );

  // One entry per filter that is actually narrowing the view. Drives the count
  // on the button and the chips beside it, so both always agree.
  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: () => void }> = [];
    const routeLabel = payload.routes.find((route) => route.id === filterRouteId);

    if (filterRouteId !== "" && routeLabel) {
      chips.push({
        key: "route",
        label: routeLabel.code,
        clear: () => onFilterRouteChange(""),
      });
    }
    if (status !== "") {
      const label = payload.statuses.find((entry) => entry.value === status)?.label ?? status;
      chips.push({ key: "status", label, clear: () => setStatus("") });
    }
    if (search.trim() !== "") {
      chips.push({ key: "search", label: `“${search.trim()}”`, clear: () => setSearch("") });
    }
    if (minAmount.trim() !== "") {
      chips.push({ key: "min", label: `≥ ₹${minAmount.trim()}`, clear: () => setMinAmount("") });
    }
    if (maxAmount.trim() !== "") {
      chips.push({ key: "max", label: `≤ ₹${maxAmount.trim()}`, clear: () => setMaxAmount("") });
    }

    return chips;
  }, [filterRouteId, maxAmount, minAmount, onFilterRouteChange, payload.routes, payload.statuses, search, status]);

  const activeFilterCount = activeFilterChips.length;

  return (
    <>
      <PageActions>
        <SecondaryButton
          type="button"
          onClick={() => setPrintSummaryOpen(true)}
          icon={<BillIcon className="h-4 w-4" />}
        >
          Print summary
        </SecondaryButton>
        <PrimaryButton
          type="button"
          onClick={() => setGenerateOpen(true)}
          icon={<BillIcon className="h-4 w-4" />}
          className="h-10 rounded-md px-5 text-sm font-semibold"
        >
          Generate bills
        </PrimaryButton>
      </PageActions>

      <div className="sticky top-[65px] z-10 -mx-4 border-b border-surface-border bg-app-bg/95 px-4 py-3 backdrop-blur transition-colors duration-200 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <MasterTabs
            tabs={[
              { value: "summary", label: "Customer Summary" },
              { value: "bills", label: "Bills" },
            ]}
            activeValue={activeTab}
            onChange={setActiveTab}
            className="w-fit shrink-0"
          />
          {/* Month stays out of the panel: it is the context you are working
              in rather than a filter, and it reloads the page. */}
          <input
            type="month"
            value={filterMonth}
            onChange={(event) => onFilterMonthChange(event.target.value)}
            className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            aria-label="Billing month"
          />
          <FilterButton activeCount={activeFilterCount} onClick={() => setFilterPanelOpen(true)} />
          {isSummary ? (
            <SecondaryButton
              type="button"
              disabled={!printAllHref}
              onClick={() => {
                if (printAllHref) {
                  window.open(printAllHref, PRINT_WINDOW_NAME);
                }
              }}
              icon={<BillIcon className="h-4 w-4" />}
              title={printAllHref ? undefined : "Select a single route to print all its bills"}
              className="h-10 px-3 text-sm"
            >
              Print all bills
            </SecondaryButton>
          ) : null}
        </div>

        {/* A chip per active filter. Collapsing the controls behind a button is
            only safe if the screen still says what it is showing — a hidden
            filter that quietly removes rows is worse than a crowded toolbar. */}
        {activeFilterChips.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {activeFilterChips.map((chip) => (
              <FilterChip key={chip.key} label={chip.label} onClear={chip.clear} />
            ))}
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-semibold text-accent underline underline-offset-2"
            >
              Clear all
            </button>
          </div>
        ) : null}
      </div>

      <FilterPanel
        open={filterPanelOpen}
        onClose={() => setFilterPanelOpen(false)}
        onClear={resetFilters}
        activeCount={activeFilterCount}
      >
        <SelectInput
          label="Route"
          value={filterRouteId}
          onChange={(event) => onFilterRouteChange(event.target.value)}
          placeholder="All routes"
          options={payload.routes.map((route) => ({
            value: route.id,
            label: `${route.code} - ${route.name}`,
          }))}
          className="h-10 rounded-md bg-surface text-sm"
        />

        {/* Status applies to both tabs — the Summary rows carry a bill status
            too, and "show me only what is still Draft" is the same question on
            either. */}
        <SelectInput
          label="Bill status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          placeholder="All statuses"
          options={payload.statuses}
          className="h-10 rounded-md bg-surface text-sm"
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-secondary">Search</span>
          <SearchInput
            name="search"
            placeholder="Customer, code, or area"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-10"
          />
        </label>

        {/* Which column the amounts apply to — "over ₹5,000" of what is
            genuinely ambiguous on a bill. Named for the figure rather than the
            column, since the two tabs label it differently. */}
        <SelectInput
          label="Amount applies to"
          value={amountField}
          onChange={(event) =>
            setAmountField(event.target.value as "closingBalance" | "deliveryAmount")
          }
          options={[
            { value: "closingBalance", label: "Outstanding" },
            { value: "deliveryAmount", label: "This month" },
          ]}
          className="h-10 rounded-md bg-surface text-sm"
        />

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-secondary">Minimum ₹</span>
            <input
              type="number"
              inputMode="decimal"
              value={minAmount}
              onChange={(event) => setMinAmount(event.target.value)}
              placeholder="Any"
              aria-label="Minimum amount"
              className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-secondary">Maximum ₹</span>
            <input
              type="number"
              inputMode="decimal"
              value={maxAmount}
              onChange={(event) => setMaxAmount(event.target.value)}
              placeholder="Any"
              aria-label="Maximum amount"
              className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            />
          </label>
        </div>
      </FilterPanel>

      {activeTab === "summary" ? (
        <CustomerSummaryTab
          summaryPayload={summaryPayload}
          statuses={payload.statuses}
          status={status}
          search={search}
          amountField={amountField}
          minAmount={minAmount}
          maxAmount={maxAmount}
        />
      ) : null}

      {activeTab === "bills" ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <SummaryStatBar
              className="flex-1"
              stats={[
                { key: "count", label: "Bills", value: `${filteredBills.length} / ${payload.bills.length}` },
                { key: "delivery", label: "Delivery", value: formatMoney(totals.delivery) },
                { key: "payments", label: "Payments", value: formatMoney(totals.payments), tone: "success" },
                {
                  key: "closing",
                  label: "Closing",
                  value: formatMoney(totals.closing),
                  tone: totals.closing > 0 ? "danger" : "success",
                },
                { key: "locked", label: "Locked", value: `${totals.locked} / ${filteredBills.length}` },
              ]}
            />
            {payload.dbConnected ? null : <StatusBadge tone="warning">Offline fallback</StatusBadge>}
          </div>

          <section>
            <DataTable
              columns={[
                { key: "customer", label: "Customer" },
                { key: "route", label: "Route", className: "w-56" },
                { key: "month", label: "Month", className: "w-32" },
                { key: "delivery", label: "Delivery", className: "w-32 text-right", headerClassName: "text-right" },
                { key: "payments", label: "Payments", className: "w-32 text-right", headerClassName: "text-right" },
                { key: "closing", label: "Closing", className: "w-32 text-right", headerClassName: "text-right" },
                { key: "status", label: "Status", className: "w-32" },
                { key: "actions", label: "Actions", className: "w-24 text-right print:hidden", headerClassName: "text-right print:hidden" },
              ]}
              rows={filteredBills.map((bill) => ({
                key: bill.id,
                cells: [
                  <div key="customer" className="min-w-[240px] truncate">
                    <span className="text-[15px] font-semibold text-text-primary">{bill.customerName}</span>
                  </div>,
                  <div key="route" className="truncate">
                    <span className="font-medium text-text-primary">{bill.routeName}</span>
                  </div>,
                  formatMonth(bill.billingMonth),
                  <span key="delivery" className="block text-right font-medium text-text-primary">
                    {formatMoney(bill.deliveryAmount)}
                  </span>,
                  <span key="payments" className="block text-right text-text-primary">
                    {formatMoney(bill.paymentAmount)}
                  </span>,
                  <span key="closing" className="block text-right font-semibold text-text-primary">
                    {formatMoney(bill.closingBalance)}
                  </span>,
                  <BillStatusButton
                    key="status"
                    billId={bill.id}
                    status={bill.status}
                    statuses={payload.statuses}
                    contextLine={
                      <>
                        <span className="font-semibold text-text-primary">{bill.customerName}</span> · {bill.routeName} ·{" "}
                        {formatMoney(bill.closingBalance)}
                      </>
                    }
                  />,
                  <div key="actions" className="flex justify-end">
                    <Link
                      href={`/monthly-bills/${bill.id}`}
                      aria-label={`View bill for ${bill.customerName}`}
                      title="View bill"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-primary transition hover:bg-surface-muted"
                    >
                      <ViewIcon className="h-[18px] w-[18px]" />
                      <span className="sr-only">View bill</span>
                    </Link>
                  </div>,
                ],
              }))}
              emptyMessage="No monthly bills match the selected filters"
              minWidth="min-w-[1100px]"
              className="rounded-md border-surface-border shadow-none"
              headClassName="bg-surface-muted/70"
              headerCellClassName="px-5 py-2.5"
              rowClassName="align-middle hover:bg-surface-muted/60"
              cellClassName="px-5 py-2.5"
            />
          </section>
        </section>
      ) : null}

      <GenerateBillsDialog
        open={generateOpen}
        dbConnected={payload.dbConnected}
        defaultMonth={defaultMonth}
        unlockedMonths={unlockedMonths}
        onClose={() => setGenerateOpen(false)}
      />

      <PrintSummaryDialog
        open={printSummaryOpen}
        routes={payload.routes}
        defaultMonth={defaultMonth}
        onClose={() => setPrintSummaryOpen(false)}
      />
    </>
  );
}
