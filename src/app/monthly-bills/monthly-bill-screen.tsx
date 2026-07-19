"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
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
import { PageActions } from "@/components/admin/page-actions";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";
import { StatusBadge } from "@/components/admin/status-badge";
import { SummaryStatBar } from "@/components/admin/summary-stat-bar";
import type {
  MonthlyBillPayload,
  MonthlyBillRecord,
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

function GenerateBillsDialog({
  open,
  dbConnected,
  defaultMonth,
  onClose,
}: {
  open: boolean;
  dbConnected: boolean;
  defaultMonth: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(generateMonthlyBills, initialState);

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
          defaultValue={defaultMonth}
          autoFocus
        />
        <div className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-text-secondary">
          This will create or refresh bill snapshots for the selected month. Existing generated
          bills for the same customer-route-month will be updated.
        </div>
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
  bill,
  statuses,
}: {
  bill: MonthlyBillRecord;
  statuses: MonthlyBillPayload["statuses"];
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [nextStatus, setNextStatus] = useState(getDefaultNextStatus(bill.status));
  const [state, action, pending] = useActionState(async (prevState: MonthlyBillActionState, formData: FormData) => {
    const result = await updateMonthlyBillStatus(prevState, formData);

    if (result.status === "success") {
      setConfirmOpen(false);
      setSubmitted(false);
    }

    return result;
  }, initialState);

  const openConfirm = () => {
    setNextStatus(getDefaultNextStatus(bill.status));
    setSubmitted(false);
    setConfirmOpen(true);
  };

  const closeConfirm = () => {
    if (!pending) {
      setConfirmOpen(false);
      setSubmitted(false);
    }
  };

  return (
    <>
      <button type="button" onClick={openConfirm} className="rounded-full text-left" title="Change bill status">
        <StatusBadge tone={statusTone(bill.status)}>{statusLabel(bill.status)}</StatusBadge>
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
        <input type="hidden" name="id" value={bill.id} />
        <SelectInput
          label="New status"
          name="status"
          value={nextStatus}
          onChange={(event) => setNextStatus(event.target.value)}
          options={statuses}
        />
        <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-text-secondary">
          <span className="font-semibold text-text-primary">{bill.customerName}</span> · {bill.routeName} ·{" "}
          {formatMoney(bill.closingBalance)}
        </p>
        {submitted && state.status === "error" && state.message ? (
          <p className="text-sm font-medium text-rose-700">{state.message}</p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

function CustomerSummaryTab({
  summaryPayload,
}: {
  summaryPayload: MonthlyBillSummaryPayload;
}) {
  const { selectedMonth } = summaryPayload;

  return (
    <div className="space-y-4">
      {summaryPayload.error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {summaryPayload.error}
        </div>
      ) : null}

      {summaryPayload.routes.length === 0 ? (
        <EmptyState message="No active routes found for this selection." />
      ) : (
        summaryPayload.routes.map((route) => (
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
                    `/monthly-bills/summary?month=${selectedMonth}&routeId=${route.id}`,
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
                  { key: "actions", label: "Actions", className: "w-20 text-right", headerClassName: "text-right" },
                ]}
                rows={[
                  ...route.rows.map((row) => ({
                    key: row.key,
                    cells: [
                      row.sequenceNo,
                      <div key="customer" className="min-w-[200px] truncate">
                        <span className="font-medium text-text-primary">{row.customerName}</span>
                        <span className="ml-1.5 text-sm text-text-muted">{row.customerCode}</span>
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
                      <div key="actions" className="flex justify-end">
                        {row.billId ? (
                          <Link
                            href={`/monthly-bills/${row.billId}`}
                            aria-label={`View bill for ${row.customerName}`}
                            title="View bill"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-primary transition hover:bg-surface-muted"
                          >
                            <ViewIcon className="h-[18px] w-[18px]" />
                            <span className="sr-only">View bill</span>
                          </Link>
                        ) : (
                          <span
                            className="text-xs text-text-muted"
                            title="Generate bills for this route and month to view this customer's bill"
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
  const defaultMonth = new Date().toISOString().slice(0, 7);
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("");
  const [routeId, setRouteId] = useState("");
  const [status, setStatus] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [printSummaryOpen, setPrintSummaryOpen] = useState(false);

  const { selectedMonth: summaryMonth, selectedRouteId: summaryRouteId } = summaryPayload;
  const goToSummary = (nextMonth: string, nextRouteId: string) => {
    const params = new URLSearchParams();
    params.set("month", nextMonth);
    if (nextRouteId) {
      params.set("routeId", nextRouteId);
    }
    router.push(`/monthly-bills?${params.toString()}`);
  };
  const printAllHref = summaryRouteId
    ? `/monthly-bills/print-all?month=${summaryMonth}&routeId=${summaryRouteId}`
    : null;

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
      const matchesMonth = month === "" || formatMonthInput(bill.billingMonth) === month;
      const matchesRoute = routeId === "" || bill.routeId === routeId;
      const matchesStatus = status === "" || bill.status === status;

      return matchesSearch && matchesMonth && matchesRoute && matchesStatus;
    });
  }, [month, payload.bills, routeId, search, status]);

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

  const hasActiveFilters = search.trim() !== "" || month !== "" || routeId !== "" || status !== "";

  const resetFilters = () => {
    setSearch("");
    setMonth("");
    setRouteId("");
    setStatus("");
  };

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
        <button
          type="button"
          onClick={() => setGenerateOpen(true)}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-blue-600 bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          <BillIcon className="h-4 w-4" />
          Generate bills
        </button>
      </PageActions>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <MasterTabs
          tabs={[
            { value: "summary", label: "Customer Summary" },
            { value: "bills", label: "Bills" },
          ]}
          activeValue={activeTab}
          onChange={setActiveTab}
          className="w-fit"
        />

        {activeTab === "summary" ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="month"
              value={summaryMonth}
              onChange={(event) => goToSummary(event.target.value, summaryRouteId)}
              className="h-9 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
              aria-label="Filter by billing month"
            />
            <SelectInput
              value={summaryRouteId}
              onChange={(event) => goToSummary(summaryMonth, event.target.value)}
              placeholder="All routes"
              options={payload.routes.map((route) => ({
                value: route.id,
                label: `${route.code} - ${route.name}`,
              }))}
              className="h-9 rounded-md bg-surface text-sm"
            />
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
              className="h-9 px-3 text-sm"
            >
              Print all bills
            </SecondaryButton>
          </div>
        ) : null}
      </div>

      {activeTab === "summary" ? <CustomerSummaryTab summaryPayload={summaryPayload} /> : null}

      {activeTab === "bills" ? (
        <section className="space-y-3">
          <SummaryStatBar
            stats={[
              { key: "delivery", label: "Delivery", value: formatMoney(totals.delivery) },
              { key: "payments", label: "Payments", value: formatMoney(totals.payments), tone: "success" },
              {
                key: "closing",
                label: "Closing",
                value: formatMoney(totals.closing),
                tone: totals.closing > 0 ? "danger" : "success",
              },
              { key: "locked", label: "Locked bills", value: `${totals.locked} / ${filteredBills.length}` },
            ]}
          />

          <div className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-center xl:justify-between">
            <div className="grid w-full gap-3 md:grid-cols-[minmax(280px,1fr)_170px_180px] xl:max-w-6xl xl:grid-cols-[minmax(320px,1fr)_170px_220px_180px]">
              <SearchInput
                name="search"
                placeholder="Search customer, route, product"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
                aria-label="Filter by billing month"
              />
              <SelectInput
                value={routeId}
                onChange={(event) => setRouteId(event.target.value)}
                placeholder="All routes"
                options={payload.routes.map((route) => ({
                  value: route.id,
                  label: `${route.code} - ${route.name}`,
                }))}
                className="h-10 rounded-md bg-surface text-sm"
              />
              <SelectInput
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                placeholder="All statuses"
                options={payload.statuses}
                className="h-10 rounded-md bg-surface text-sm"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="whitespace-nowrap text-sm text-text-secondary">
                {filteredBills.length} of {payload.bills.length} bills
              </span>
              {payload.dbConnected ? null : <StatusBadge tone="warning">Offline fallback</StatusBadge>}
              {hasActiveFilters ? (
                <SecondaryButton type="button" onClick={resetFilters} className="h-10 px-4 text-sm font-medium">
                  Clear
                </SecondaryButton>
              ) : null}
            </div>
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
                { key: "actions", label: "Actions", className: "w-24 text-right", headerClassName: "text-right" },
              ]}
              rows={filteredBills.map((bill) => ({
                key: bill.id,
                cells: [
                  <div key="customer" className="min-w-[240px] truncate">
                    <span className="text-[15px] font-semibold text-text-primary">{bill.customerName}</span>
                    <span className="ml-1.5 text-sm text-text-muted">{bill.customerCode}</span>
                  </div>,
                  <div key="route" className="truncate">
                    <span className="font-medium text-text-primary">{bill.routeName}</span>
                    <span className="ml-1.5 text-sm text-text-muted">{bill.routeCode}</span>
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
                  <BillStatusButton key="status" bill={bill} statuses={payload.statuses} />,
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
