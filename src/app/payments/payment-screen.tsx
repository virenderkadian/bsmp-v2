"use client";

import { useActionState, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  createPayment,
  setPaymentStatus,
  type PaymentActionState,
  updatePayment,
} from "@/app/payments/actions";
import { ActionButton, PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { DataTable } from "@/components/admin/data-table";
import { Dialog } from "@/components/admin/dialog";
import { FormInput } from "@/components/admin/form-input";
import { PencilSquareIcon, PlusIcon } from "@/components/admin/icons";
import { KeyboardForm } from "@/components/admin/keyboard-form";
import { usePageMetric } from "@/components/admin/page-metric";
import { Pagination } from "@/components/admin/pagination";
import { usePagination } from "@/lib/use-pagination";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";
import { StatusBadge } from "@/components/admin/status-badge";
import { SummaryStatBar } from "@/components/admin/summary-stat-bar";
import type { PaymentRecord, PaymentsPayload } from "@/lib/payments";

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
  mode,
  dbConnected,
  draft,
  payload,
  onClose,
}: {
  open: boolean;
  mode: "create" | "edit";
  dbConnected: boolean;
  draft: PaymentDraft;
  payload: PaymentsPayload;
  onClose: () => void;
}) {
  const [createState, createAction, createPending] = useActionState(createPayment, initialState);
  const [updateState, updateAction, updatePending] = useActionState(updatePayment, initialState);
  const [customerId, setCustomerId] = useState(draft.customerId);
  const [routeId, setRouteId] = useState(draft.routeId);
  const [paymentDate, setPaymentDate] = useState(draft.paymentDate);
  const state = mode === "create" ? createState : updateState;
  const pending = mode === "create" ? createPending : updatePending;

  // The dialog is mounted fresh each time it opens (the parent renders it
  // conditionally), so the useState initializers above already seed the
  // fields from `draft` — no reset effect needed.

  useEffect(() => {
    if (open && state.status === "success") {
      onClose();
    }
  }, [onClose, open, state.status]);

  const routeOptions = useMemo(() => {
    const month = paymentDate.slice(0, 7);
    const linkedRouteIds = new Set(
      payload.customerRouteLinks
        .filter((link) => link.customerId === customerId && link.month === month)
        .map((link) => link.routeId),
    );
    const linkedRoutes = payload.routes.filter((route) => linkedRouteIds.has(route.id));

    return linkedRoutes.length > 0 ? linkedRoutes : payload.routes;
  }, [customerId, paymentDate, payload.customerRouteLinks, payload.routes]);

  // Auto-select the only linked route, or clear a route that no longer applies
  // to the picked customer/month. Done during render (React's "adjust state
  // while rendering" pattern), keyed on the option set so it only re-runs when
  // the available routes actually change — no effect, no cascading render.
  const routeOptionKey = routeOptions.map((route) => route.id).join(",");
  const [lastRouteOptionKey, setLastRouteOptionKey] = useState(routeOptionKey);
  if (routeOptionKey !== lastRouteOptionKey) {
    setLastRouteOptionKey(routeOptionKey);
    if (routeOptions.length === 1 && routeId !== routeOptions[0].id) {
      setRouteId(routeOptions[0].id);
    } else if (
      routeOptions.length > 1 &&
      routeId &&
      !routeOptions.some((route) => route.id === routeId)
    ) {
      setRouteId("");
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (mode !== "edit") {
      return;
    }

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
      title={mode === "create" ? "Add payment" : "Edit payment"}
      description="Record and verify customer collections used by monthly bills and reconciliation."
      footer={null}
    >
      <KeyboardForm
        action={mode === "create" ? createAction : updateAction}
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        {mode === "edit" && draft.id ? <input type="hidden" name="id" value={draft.id} /> : null}
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
            {pending ? "Saving..." : mode === "create" ? "Save payment" : "Update payment"}
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
  const [search, setSearch] = useState("");
  const [routeId, setRouteId] = useState("");
  const [mode, setMode] = useState("");
  const [status, setStatus] = useState("");
  const [date, setDate] = useState("");
  const [dialogMode, setDialogMode] = useState<PaymentDialogMode>(null);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);

  const selectedPayment = payload.payments.find((payment) => payment.id === selectedPaymentId);
  const draft = getPaymentDraft(selectedPayment);

  const filteredPayments = useMemo(() => {
    return payload.payments.filter((payment) => {
      const query = search.toLowerCase().trim();
      const matchesSearch =
        query === "" ||
        payment.customerCode.toLowerCase().includes(query) ||
        payment.customerName.toLowerCase().includes(query) ||
        (payment.customerArea ?? "").toLowerCase().includes(query) ||
        (payment.routeCode ?? "").toLowerCase().includes(query) ||
        (payment.routeName ?? "").toLowerCase().includes(query) ||
        (payment.referenceNo ?? "").toLowerCase().includes(query) ||
        (payment.notes ?? "").toLowerCase().includes(query);
      const matchesRoute = routeId === "" || payment.routeId === routeId;
      const matchesMode = mode === "" || payment.mode === mode;
      const matchesStatus = status === "" || payment.status === status;
      const matchesDate = date === "" || formatDateInput(payment.paymentDate) === date;

      return matchesSearch && matchesRoute && matchesMode && matchesStatus && matchesDate;
    });
  }, [date, mode, payload.payments, routeId, search, status]);

  const totals = useMemo(() => {
    return filteredPayments.reduce(
      (current, payment) => {
        const amount = Number(payment.amount);

        current.total += amount;
        if (payment.status === "VERIFIED") {
          current.verified += amount;
        } else if (payment.status === "PENDING") {
          current.pending += amount;
        } else {
          current.cancelled += amount;
        }

        return current;
      },
      { total: 0, verified: 0, pending: 0, cancelled: 0 },
    );
  }, [filteredPayments]);

  const hasActiveFilters = search.trim() !== "" || routeId !== "" || mode !== "" || status !== "" || date !== "";

  const pagination = usePagination(filteredPayments, {
    resetKey: `${search}|${routeId}|${mode}|${status}|${date}`,
  });

  const pendingCount = useMemo(
    () => payload.payments.filter((payment) => payment.status === "PENDING").length,
    [payload.payments],
  );
  usePageMetric(
    pendingCount > 0
      ? { label: "Pending", value: String(pendingCount), tone: "warning" }
      : { label: "Payments", value: String(payload.payments.length) },
  );

  const resetFilters = () => {
    setSearch("");
    setRouteId("");
    setMode("");
    setStatus("");
    setDate("");
  };

  const openCreateDialog = () => {
    setSelectedPaymentId(null);
    setDialogMode("create");
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
              { key: "total", label: "Filtered total", value: formatMoney(String(totals.total)) },
              { key: "verified", label: "Verified", value: formatMoney(String(totals.verified)), tone: "success" },
              { key: "pending", label: "Pending", value: formatMoney(String(totals.pending)) },
              { key: "cancelled", label: "Cancelled", value: formatMoney(String(totals.cancelled)), tone: "danger" },
            ]}
          />
          <div className="flex items-center gap-2 lg:shrink-0">
            <Link
              href="/payments/bulk-entry"
              className="inline-flex h-10 items-center justify-center rounded-md border border-surface-border-strong bg-surface px-4 text-sm font-semibold text-text-secondary transition hover:bg-surface-muted"
            >
              Bulk route entry
            </Link>
            <PrimaryButton
              type="button"
              onClick={openCreateDialog}
              icon={<PlusIcon className="h-4 w-4" />}
              className="h-10 shrink-0 rounded-md px-4 text-sm font-semibold"
            >
              Add payment
            </PrimaryButton>
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-center xl:justify-between">
          <div className="grid w-full gap-3 md:grid-cols-[minmax(280px,1fr)_180px_170px] xl:max-w-6xl xl:grid-cols-[minmax(300px,1fr)_220px_160px_170px_180px]">
            <SearchInput
              name="search"
              placeholder="Search customer, route, reference"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
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
              value={mode}
              onChange={(event) => setMode(event.target.value)}
              placeholder="All modes"
              options={payload.modes}
              className="h-10 rounded-md bg-surface text-sm"
            />
            <SelectInput
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              placeholder="All statuses"
              options={payload.statuses}
              className="h-10 rounded-md bg-surface text-sm"
            />
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
              aria-label="Filter by payment date"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="whitespace-nowrap text-sm text-text-secondary">
              {filteredPayments.length} of {payload.payments.length} payments
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
            rows={pagination.pageItems.map((payment) => ({
              key: payment.id,
              cells: [
                <div key="customer" className="min-w-[240px] truncate">
                  <span className="text-[15px] font-semibold text-text-primary">{payment.customerName}</span>
                  <span className="ml-1.5 text-sm text-text-muted">
                    {payment.customerCode}
                    {payment.customerArea ? ` · ${payment.customerArea}` : ""}
                  </span>
                </div>,
                <div key="route" className="min-w-[200px] truncate">
                  <span className="font-medium text-text-primary">
                    {routeLabel(payment.routeCode, payment.routeName)}
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
                  {payment.referenceNo || payment.notes || "-"}
                </span>,
                <div key="actions" className="flex justify-end">
                  <ActionButton
                    type="button"
                    icon={<PencilSquareIcon className="h-[18px] w-[18px]" />}
                    className="h-9 w-9 justify-center rounded-md border-surface-border-strong bg-surface px-0 text-text-secondary hover:border-accent hover:bg-accent-soft hover:text-accent-soft-text"
                    onClick={() => openEditDialog(payment.id)}
                    aria-label="Edit payment"
                    title="Edit payment"
                  >
                    <span className="sr-only">Edit payment</span>
                  </ActionButton>
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
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            startIndex={pagination.startIndex}
            endIndex={pagination.endIndex}
            onPageChange={pagination.setPage}
            itemLabel="payments"
          />
        </section>
      </section>

      {dialogMode === "create" ? (
        <PaymentDialog
          open
          mode="create"
          dbConnected={payload.dbConnected}
          draft={emptyPaymentDraft}
          payload={payload}
          onClose={closeDialog}
        />
      ) : null}

      {dialogMode === "edit" && selectedPayment ? (
        <PaymentDialog
          open
          mode="edit"
          dbConnected={payload.dbConnected}
          draft={draft}
          payload={payload}
          onClose={closeDialog}
        />
      ) : null}
    </>
  );
}
