"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  getCustomerRoutesForMonth,
  setPaymentStatus,
  type PaymentActionState,
  updatePayment,
} from "@/app/payments/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { DataTable } from "@/components/admin/data-table";
import { Dialog } from "@/components/admin/dialog";
import { FormInput } from "@/components/admin/form-input";
import { HighlightMatch } from "@/components/admin/highlight-match";
import { IconButton } from "@/components/admin/icon-button";
import { PencilSquareIcon } from "@/components/admin/icons";
import { KeyboardForm } from "@/components/admin/keyboard-form";
import { useLoadingBar } from "@/components/admin/loading-bar";
import { usePageMetric } from "@/components/admin/page-metric";
import { Pagination } from "@/components/admin/pagination";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";
import { StatusBadge } from "@/components/admin/status-badge";
import { SummaryStatBar } from "@/components/admin/summary-stat-bar";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import type { PaymentRecord, PaymentRouteOption, PaymentsPayload } from "@/lib/payments";

const initialState: PaymentActionState = { status: "idle" };

type PaymentScreenProps = {
  payload: PaymentsPayload;
};

type PaymentDialogMode = "create" | "edit" | null;

type PaymentDraft = {
  id?: string;
  customerId: string;
  routeId: string;
  amount: string;
  paymentDate: string;
  mode: string;
  status: string;
  referenceNo: string;
  notes: string;
};

const emptyPaymentDraft: PaymentDraft = {
  customerId: "",
  routeId: "",
  amount: "",
  paymentDate: new Date().toISOString().slice(0, 10),
  mode: "CASH",
  status: "VERIFIED",
  referenceNo: "",
  notes: "",
};

function formatDateInput(value: Date) {
  return new Date(value).toISOString().slice(0, 10);
}

function formatDate(value: Date) {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMoney(value: string) {
  return `₹${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizeText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAmount(value: FormDataEntryValue | null) {
  const amount = Number(normalizeText(value));
  return Number.isFinite(amount) ? amount.toFixed(2) : "";
}

function getPaymentDraft(payment?: PaymentRecord): PaymentDraft {
  if (!payment) {
    return emptyPaymentDraft;
  }

  return {
    id: payment.id,
    customerId: payment.customerId,
    routeId: payment.routeId ?? "",
    amount: payment.amount,
    paymentDate: formatDateInput(payment.paymentDate),
    mode: payment.mode,
    status: payment.status,
    referenceNo: payment.referenceNo ?? "",
    notes: payment.notes ?? "",
  };
}

function statusTone(status: string) {
  if (status === "VERIFIED") {
    return "success" as const;
  }

  if (status === "CANCELLED") {
    return "danger" as const;
  }

  return "warning" as const;
}

function statusLabel(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function modeLabel(mode: string, modes: PaymentsPayload["modes"]) {
  return modes.find((option) => option.value === mode)?.label ?? mode;
}

function routeLabel(routeCode: string | null, routeName: string | null) {
  if (!routeCode && !routeName) {
    return "Unallocated";
  }

  return [routeCode, routeName].filter(Boolean).join(" - ");
}

function getDefaultNextStatus(status: string) {
  if (status === "PENDING") {
    return "VERIFIED";
  }

  if (status === "VERIFIED") {
    return "PENDING";
  }

  return "PENDING";
}

function PaymentDialog({
  open,
  dbConnected,
  draft,
  payload,
  onClose,
}: {
  open: boolean;
  dbConnected: boolean;
  draft: PaymentDraft;
  payload: PaymentsPayload;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(updatePayment, initialState);
  const [customerId, setCustomerId] = useState(draft.customerId);
  const [routeId, setRouteId] = useState(draft.routeId);
  const [paymentDate, setPaymentDate] = useState(draft.paymentDate);

  // The dialog is mounted fresh each time it opens (the parent renders it
  // conditionally), so the useState initializers above already seed the
  // fields from `draft` — no reset effect needed.

  useEffect(() => {
    if (open && state.status === "success") {
      onClose();
    }
  }, [onClose, open, state.status]);

  // Which route(s) this customer was actually on for the picked month — used
  // to be a client-side lookup into every customer's route for every month
  // ever assigned (unbounded, growing every month); now resolved on demand
  // for just this one customer/month, since that's all a single dialog needs.
  const [linkedRoutes, setLinkedRoutes] = useState<PaymentRouteOption[] | null>(null);
  const routeRequestId = useRef(0);

  useEffect(() => {
    if (!customerId) {
      // Clearing a stale result when there's no customer to resolve a route
      // for — not syncing derived state from this render, the carve-out
      // react-hooks/set-state-in-effect's own guidance makes.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkedRoutes(null);
      return;
    }

    const requestId = ++routeRequestId.current;
    const month = paymentDate.slice(0, 7);

    getCustomerRoutesForMonth(customerId, month).then((routes) => {
      if (routeRequestId.current !== requestId) {
        return;
      }

      setLinkedRoutes(routes);

      // Auto-select the only linked route, or clear a route that no longer
      // applies to the picked customer/month.
      if (routes.length === 1) {
        setRouteId(routes[0].id);
      } else if (routes.length > 1) {
        setRouteId((current) => (routes.some((route) => route.id === current) ? current : ""));
      }
    });
  }, [customerId, paymentDate]);

  const routeOptions = linkedRoutes && linkedRoutes.length > 0 ? linkedRoutes : payload.routes;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    const formData = new FormData(event.currentTarget);
    const hasChanges =
      normalizeText(formData.get("customerId")) !== draft.customerId ||
      normalizeText(formData.get("routeId")) !== draft.routeId ||
      normalizeAmount(formData.get("amount")) !== Number(draft.amount).toFixed(2) ||
      normalizeText(formData.get("paymentDate")) !== draft.paymentDate ||
      normalizeText(formData.get("mode")) !== draft.mode ||
      normalizeText(formData.get("status")) !== draft.status ||
      normalizeText(formData.get("referenceNo")) !== draft.referenceNo ||
      normalizeText(formData.get("notes")) !== draft.notes;

    if (!hasChanges) {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit payment"
      description="Record and verify customer collections used by monthly bills and reconciliation."
      footer={null}
    >
      <KeyboardForm
        action={formAction}
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        {draft.id ? <input type="hidden" name="id" value={draft.id} /> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <SelectInput
            label="Customer"
            name="customerId"
            value={customerId}
            onChange={(event) => {
              setCustomerId(event.target.value);
              setRouteId("");
            }}
            placeholder="Select customer"
            options={payload.customers.map((customer) => ({
              value: customer.id,
              label: `${customer.code} - ${customer.name}${customer.area ? ` (${customer.area})` : ""}`,
            }))}
            autoFocus
          />
          <SelectInput
            label="Route"
            name="routeId"
            value={routeId}
            onChange={(event) => setRouteId(event.target.value)}
            placeholder={
              customerId
                ? routeOptions.length === payload.routes.length
                  ? "Select route"
                  : "Select customer route"
                : "Select customer first"
            }
            options={routeOptions.map((route) => ({
              value: route.id,
              label: `${route.code} - ${route.name} ${route.shift === "MORNING" ? "Morning" : "Evening"}`,
            }))}
          />
          <FormInput
            label="Amount"
            name="amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="1250"
            defaultValue={draft.amount}
          />
          <FormInput
            label="Payment date"
            name="paymentDate"
            type="date"
            value={paymentDate}
            onChange={(event) => {
              setPaymentDate(event.target.value);
              setRouteId("");
            }}
          />
          <SelectInput label="Mode" name="mode" defaultValue={draft.mode} options={payload.modes} />
          <SelectInput label="Status" name="status" defaultValue={draft.status} options={payload.statuses} />
          <FormInput
            label="Reference no"
            name="referenceNo"
            placeholder="UPI / cheque / receipt"
            defaultValue={draft.referenceNo}
          />
          <div className="md:col-span-2">
            <FormInput label="Notes" name="notes" placeholder="Optional note" defaultValue={draft.notes} />
          </div>
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
          <PrimaryButton type="submit" disabled={pending || payload.customers.length === 0 || payload.routes.length === 0}>
            {pending ? "Saving..." : "Update payment"}
          </PrimaryButton>
        </div>
      </KeyboardForm>
    </Dialog>
  );
}

function PaymentStatusButton({
  payment,
  statuses,
}: {
  payment: PaymentRecord;
  statuses: PaymentsPayload["statuses"];
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [nextStatus, setNextStatus] = useState(getDefaultNextStatus(payment.status));
  const [state, action, pending] = useActionState(async (prevState: PaymentActionState, formData: FormData) => {
    const result = await setPaymentStatus(prevState, formData);

    if (result.status === "success") {
      setConfirmOpen(false);
      setSubmitted(false);
    }

    return result;
  }, initialState);

  const openConfirm = () => {
    setNextStatus(getDefaultNextStatus(payment.status));
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
      <button type="button" onClick={openConfirm} className="rounded-full text-left" title="Change payment status">
        <StatusBadge tone={statusTone(payment.status)}>{statusLabel(payment.status)}</StatusBadge>
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Change payment status?"
        description="Update the verification state for this customer collection."
        confirmLabel="Update status"
        pending={pending}
        onClose={closeConfirm}
        action={action}
        onSubmit={() => setSubmitted(true)}
      >
        <input type="hidden" name="id" value={payment.id} />
        <SelectInput
          label="New status"
          name="status"
          value={nextStatus}
          onChange={(event) => setNextStatus(event.target.value)}
          options={statuses}
        />
        <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-text-secondary">
          <span className="font-semibold text-text-primary">{payment.customerName}</span> ·{" "}
          {formatMoney(payment.amount)} · {formatDate(payment.paymentDate)}
        </p>
        {submitted && state.status === "error" && state.message ? (
          <p className="text-sm font-medium text-rose-700">{state.message}</p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

export function PaymentScreen({ payload }: PaymentScreenProps) {
  const { navigate } = useLoadingBar();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlSearch = searchParams.get("search") ?? "";
  const urlRouteId = searchParams.get("routeId") ?? "";
  const urlMode = searchParams.get("mode") ?? "";
  const urlStatus = searchParams.get("status") ?? "";
  const urlDate = searchParams.get("date") ?? "";

  const [searchInput, setSearchInput] = useState(urlSearch);
  const debouncedSearch = useDebouncedValue(searchInput, 350);

  const [dialogMode, setDialogMode] = useState<PaymentDialogMode>(null);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);

  const selectedPayment = payload.payments.find((payment) => payment.id === selectedPaymentId);
  const draft = getPaymentDraft(selectedPayment);

  const updateParams = (next: Record<string, string>, options?: { resetPage?: boolean }) => {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(next)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }

    if (options?.resetPage !== false) {
      params.delete("page");
    }

    navigate(params.toString() ? `${pathname}?${params.toString()}` : pathname, { replace: true, scroll: false });
  };

  useEffect(() => {
    if (debouncedSearch !== urlSearch) {
      updateParams({ search: debouncedSearch });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const [lastUrlSearch, setLastUrlSearch] = useState(urlSearch);
  if (urlSearch !== lastUrlSearch) {
    setLastUrlSearch(urlSearch);
    setSearchInput(urlSearch);
  }

  const hasActiveFilters =
    urlSearch.trim() !== "" || urlRouteId !== "" || urlMode !== "" || urlStatus !== "" || urlDate !== "";

  const totalPages = Math.max(1, Math.ceil(payload.total / payload.pageSize));
  const startIndex = payload.total === 0 ? 0 : (payload.page - 1) * payload.pageSize + 1;
  const endIndex = Math.min(payload.page * payload.pageSize, payload.total);

  usePageMetric(
    payload.pendingCount > 0
      ? { label: "Pending", value: String(payload.pendingCount), tone: "warning" }
      : { label: "Payments", value: String(payload.total) },
  );

  const resetFilters = () => {
    setSearchInput("");
    navigate(pathname, { replace: true, scroll: false });
  };

  const openEditDialog = (paymentId: string) => {
    setSelectedPaymentId(paymentId);
    setDialogMode("edit");
  };

  const closeDialog = () => {
    setDialogMode(null);
    setSelectedPaymentId(null);
  };

  return (
    <>
      <section className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SummaryStatBar
            className="flex-1"
            stats={[
              { key: "total", label: "Filtered total", value: formatMoney(payload.totals.total) },
              { key: "verified", label: "Verified", value: formatMoney(payload.totals.verified), tone: "success" },
              { key: "pending", label: "Pending", value: formatMoney(payload.totals.pending) },
              { key: "cancelled", label: "Cancelled", value: formatMoney(payload.totals.cancelled), tone: "danger" },
            ]}
          />
          <div className="flex items-center gap-2 lg:shrink-0">
            {/* The only way in. One-off entry used to live here as a dialog,
                but it asked for a customer, a route and an amount with no
                indication of what was actually owed — the collections sheet
                shows the outstanding figure beside every name, and reaches
                anyone by search, so it does that job strictly better. */}
            <Link
              href="/payments/bulk-entry"
              className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Collect payments
            </Link>

          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-center xl:justify-between">
          <div className="grid w-full gap-3 md:grid-cols-[minmax(280px,1fr)_180px_170px] xl:max-w-6xl xl:grid-cols-[minmax(300px,1fr)_220px_160px_170px_180px]">
            <SearchInput
              name="search"
              placeholder="Search customer, route, reference"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            <SelectInput
              value={urlRouteId}
              onChange={(event) => updateParams({ routeId: event.target.value })}
              placeholder="All routes"
              options={payload.routes.map((route) => ({
                value: route.id,
                label: `${route.code} - ${route.name}`,
              }))}
              className="h-10 rounded-md bg-surface text-sm"
            />
            <SelectInput
              value={urlMode}
              onChange={(event) => updateParams({ mode: event.target.value })}
              placeholder="All modes"
              options={payload.modes}
              className="h-10 rounded-md bg-surface text-sm"
            />
            <SelectInput
              value={urlStatus}
              onChange={(event) => updateParams({ status: event.target.value })}
              placeholder="All statuses"
              options={payload.statuses}
              className="h-10 rounded-md bg-surface text-sm"
            />
            <input
              type="date"
              value={urlDate}
              onChange={(event) => updateParams({ date: event.target.value })}
              className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
              aria-label="Filter by payment date"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="whitespace-nowrap text-sm text-text-secondary">
              {payload.payments.length} of {payload.total} payments
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
              { key: "amount", label: "Amount", className: "w-36 text-right", headerClassName: "text-right" },
              { key: "date", label: "Date", className: "w-36" },
              { key: "mode", label: "Mode", className: "w-40" },
              { key: "status", label: "Status", className: "w-36" },
              { key: "reference", label: "Reference", className: "w-52" },
              { key: "actions", label: "Actions", className: "w-24 text-right", headerClassName: "text-right" },
            ]}
            rows={payload.payments.map((payment) => ({
              key: payment.id,
              cells: [
                <div key="customer" className="min-w-[240px] truncate">
                  <span className="text-[15px] font-semibold text-text-primary">
                    <HighlightMatch text={payment.customerName} query={urlSearch} />
                  </span>
                  <span className="ml-1.5 text-sm text-text-muted">
                    <HighlightMatch text={payment.customerCode} query={urlSearch} />
                    {payment.customerArea ? (
                      <>
                        {" · "}
                        <HighlightMatch text={payment.customerArea} query={urlSearch} />
                      </>
                    ) : null}
                  </span>
                </div>,
                <div key="route" className="min-w-[200px] truncate">
                  <span className="font-medium text-text-primary">
                    <HighlightMatch text={routeLabel(payment.routeCode, payment.routeName)} query={urlSearch} />
                  </span>
                  {payment.routeShift ? (
                    <span className="ml-1.5 text-sm text-text-muted">
                      {payment.routeShift === "MORNING" ? "Morning" : "Evening"}
                    </span>
                  ) : null}
                </div>,
                <span key="amount" className="block text-right font-semibold text-text-primary">
                  {formatMoney(payment.amount)}
                </span>,
                formatDate(payment.paymentDate),
                modeLabel(payment.mode, payload.modes),
                <PaymentStatusButton key="status" payment={payment} statuses={payload.statuses} />,
                <span key="reference" className="text-sm text-text-primary">
                  {payment.referenceNo || payment.notes ? (
                    <HighlightMatch text={payment.referenceNo || payment.notes || ""} query={urlSearch} />
                  ) : (
                    "-"
                  )}
                </span>,
                <div key="actions" className="flex justify-end">
                  <IconButton
                    type="button"
                    onClick={() => openEditDialog(payment.id)}
                    aria-label="Edit payment"
                    title="Edit payment"
                  >
                    <PencilSquareIcon className="h-[18px] w-[18px]" />
                  </IconButton>
                </div>,
              ],
            }))}
            emptyMessage="No payments match the selected filters"
            minWidth="min-w-[1160px]"
            className="rounded-md border-surface-border shadow-none"
            headClassName="bg-surface-muted/70"
            headerCellClassName="px-5 py-2.5"
            rowClassName="align-middle hover:bg-surface-muted/60"
            cellClassName="px-5 py-2.5"
          />

          <Pagination
            page={payload.page}
            totalPages={totalPages}
            total={payload.total}
            startIndex={startIndex}
            endIndex={endIndex}
            onPageChange={(nextPage) => updateParams({ page: String(nextPage) }, { resetPage: false })}
            itemLabel="payments"
          />
        </section>
      </section>

      {dialogMode === "edit" && selectedPayment ? (
        <PaymentDialog
          open
          dbConnected={payload.dbConnected}
          draft={draft}
          payload={payload}
          onClose={closeDialog}
        />
      ) : null}
    </>
  );
}
