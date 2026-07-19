"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createBulkRoutePayments, type PaymentActionState } from "@/app/payments/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { DataTable } from "@/components/admin/data-table";
import { EmptyState } from "@/components/admin/empty-state";
import { IconButton } from "@/components/admin/icon-button";
import { PlusIcon, SearchIcon, XIcon } from "@/components/admin/icons";
import { LoadingSpinner } from "@/components/admin/loading-spinner";
import { usePageMetric } from "@/components/admin/page-metric";
import { SelectInput } from "@/components/admin/select-input";
import { StatusBadge } from "@/components/admin/status-badge";
import { StatusChip } from "@/components/admin/status-chip";
import { StickyActionBar } from "@/components/admin/sticky-action-bar";
import { Toast, type ToastTone } from "@/components/admin/toast";
import type { BulkPaymentCustomerRow, BulkPaymentPayload } from "@/lib/payments";
import { cn } from "@/lib/utils";

const initialState: PaymentActionState = { status: "idle" };

type DraftPaymentRow = {
  customerId: string;
  amount: string;
};

type ToastState = {
  tone: ToastTone;
  message: string;
};

function formatMoney(value: string | number) {
  return `₹${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatRouteOption(route: BulkPaymentPayload["routes"][number]) {
  return `${route.code} - ${route.name} ${route.shift === "MORNING" ? "Morning" : "Evening"}`;
}

function formatCustomerMeta(customer: BulkPaymentCustomerRow) {
  return [customer.customerCode, customer.customerArea, customer.customerMobile]
    .filter(Boolean)
    .join(" · ");
}

function matchesCustomer(customer: BulkPaymentCustomerRow, query: string) {
  const searchText = [
    customer.customerCode,
    customer.customerName,
    customer.customerArea,
    customer.customerMobile,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return searchText.includes(query.toLowerCase().trim());
}

function getSuggestedAmount(customer: BulkPaymentCustomerRow) {
  const pending = Number(customer.pendingAmount);
  return pending > 0 ? pending.toFixed(2) : "";
}

function getPositiveAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function CustomerSuggestionRow({
  customer,
  active,
  inDraft,
  onSelect,
}: {
  customer: BulkPaymentCustomerRow;
  active: boolean;
  inDraft: boolean;
  onSelect: (customer: BulkPaymentCustomerRow) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center justify-between gap-4 px-3 py-2.5 text-left transition",
        active ? "bg-accent-soft" : "bg-surface hover:bg-surface-muted",
      )}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSelect(customer)}
    >
      <span>
        <span className="block text-sm font-semibold text-text-primary">{customer.customerName}</span>
        <span className="mt-0.5 block text-xs font-medium uppercase tracking-[0.12em] text-text-secondary">
          {formatCustomerMeta(customer) || "-"}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <span className="text-xs font-semibold text-text-secondary">
          Pending {formatMoney(customer.pendingAmount)}
        </span>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-semibold",
            inDraft ? "bg-amber-50 text-amber-700" : "bg-surface-muted text-text-secondary",
          )}
        >
          {inDraft ? "In draft" : "Enter"}
        </span>
      </span>
    </button>
  );
}

function RouteMonthToolbar({
  payload,
  routeId,
  month,
  paymentDate,
  mode,
  status,
  dirty,
  onRouteIdChange,
  onMonthChange,
  onPaymentDateChange,
  onModeChange,
  onStatusChange,
}: {
  payload: BulkPaymentPayload;
  routeId: string;
  month: string;
  paymentDate: string;
  mode: string;
  status: string;
  dirty: boolean;
  onRouteIdChange: (value: string) => void;
  onMonthChange: (value: string) => void;
  onPaymentDateChange: (value: string) => void;
  onModeChange: (value: string) => void;
  onStatusChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <form
        action="/payments/bulk-entry"
        className="grid gap-3 lg:grid-cols-[minmax(260px,1.4fr)_170px_170px_150px_150px_auto] lg:items-end"
      >
        <SelectInput
          label="Route"
          name="routeId"
          value={routeId}
          onChange={(event) => onRouteIdChange(event.target.value)}
          placeholder="Select route"
          options={payload.routes.map((route) => ({
            value: route.id,
            label: formatRouteOption(route),
          }))}
          className="h-10 rounded-md bg-surface text-sm"
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-secondary">Billing month</span>
          <input
            type="month"
            name="month"
            value={month}
            onChange={(event) => onMonthChange(event.target.value)}
            className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-secondary">Payment date</span>
          <input
            type="date"
            name="paymentDate"
            value={paymentDate}
            onChange={(event) => onPaymentDateChange(event.target.value)}
            className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
          />
        </label>
        <SelectInput
          label="Mode"
          value={mode}
          onChange={(event) => onModeChange(event.target.value)}
          options={payload.modes}
          className="h-10 rounded-md bg-surface text-sm"
        />
        <SelectInput
          label="Status"
          value={status}
          onChange={(event) => onStatusChange(event.target.value)}
          options={payload.statuses}
          className="h-10 rounded-md bg-surface text-sm"
        />
        <PrimaryButton type="submit" className="h-10 rounded-md px-5 text-sm font-semibold">
          Load
        </PrimaryButton>
      </form>

      {dirty ? (
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone="warning">Load changed route/month</StatusChip>
        </div>
      ) : null}
      {payload.error ? <p className="text-sm font-medium text-rose-700">{payload.error}</p> : null}
    </div>
  );
}

function AddCustomerBar({
  query,
  amount,
  suggestionsOpen,
  highlightedIndex,
  selectedCustomer,
  suggestions,
  draftCustomerIds,
  disabled,
  searchInputRef,
  amountInputRef,
  onQueryChange,
  onAmountChange,
  onSuggestionsOpenChange,
  onHighlightedIndexChange,
  onSelectCustomer,
  onAddSelected,
  onClearDraft,
  canClearDraft,
  routeCustomerCount,
  nextRow,
}: {
  query: string;
  amount: string;
  suggestionsOpen: boolean;
  highlightedIndex: number;
  selectedCustomer: BulkPaymentCustomerRow | undefined;
  suggestions: BulkPaymentCustomerRow[];
  draftCustomerIds: Set<string>;
  disabled: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  amountInputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onAmountChange: (value: string) => void;
  onSuggestionsOpenChange: (open: boolean) => void;
  onHighlightedIndexChange: (index: number | ((index: number) => number)) => void;
  onSelectCustomer: (customer: BulkPaymentCustomerRow) => void;
  onAddSelected: () => void;
  onClearDraft: () => void;
  canClearDraft: boolean;
  routeCustomerCount: number;
  nextRow: number;
}) {
  const activeIndex = suggestions.length === 0 ? -1 : Math.min(highlightedIndex, suggestions.length - 1);
  const activeSuggestion = suggestions[activeIndex] ?? suggestions[0];

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onSuggestionsOpenChange(true);
      onHighlightedIndexChange((index) =>
        suggestions.length === 0 ? 0 : Math.min(index + 1, suggestions.length - 1),
      );
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onHighlightedIndexChange((index) => Math.max(index - 1, 0));
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (activeSuggestion) {
        onSelectCustomer(activeSuggestion);
      }
    }

    if (event.key === "Escape") {
      onQueryChange("");
      onSuggestionsOpenChange(false);
      onHighlightedIndexChange(0);
    }
  };

  return (
    <div className="sticky top-[65px] z-20 -mx-4 space-y-2 border-b border-surface-border bg-app-bg/95 px-4 py-3 backdrop-blur transition-colors duration-200 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold text-text-primary">Payment entry sheet</h2>
        <StatusChip tone="neutral">{routeCustomerCount} route customers</StatusChip>
        <StatusChip tone="info">Next row: {routeCustomerCount > 0 ? nextRow : 0}</StatusChip>
        {selectedCustomer ? (
          <StatusBadge tone={selectedCustomer.source === "BILL" ? "success" : "warning"}>
            {selectedCustomer.source === "BILL" ? "Bill backed" : "Estimate"}
          </StatusBadge>
        ) : null}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(320px,1fr)_160px_auto] xl:items-start">
        <div className="relative">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-secondary">Customer</span>
            <span className="relative block">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onFocus={() => onSuggestionsOpenChange(true)}
                onBlur={() => {
                  window.setTimeout(() => onSuggestionsOpenChange(false), 120);
                }}
                onChange={(event) => {
                  onQueryChange(event.target.value);
                  onSuggestionsOpenChange(true);
                  onHighlightedIndexChange(0);
                }}
                onKeyDown={handleSearchKeyDown}
                disabled={disabled}
                placeholder={disabled ? "Load a route/month first" : "Search by name, code, area, or phone"}
                autoComplete="off"
                className="h-10 w-full rounded-md border border-surface-border-strong bg-surface pl-11 pr-3 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-accent disabled:bg-surface-muted disabled:text-text-muted"
              />
            </span>
          </label>

          {suggestionsOpen ? (
            <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-30 max-h-80 overflow-y-auto rounded-md border border-surface-border bg-surface shadow-lg">
              {suggestions.length > 0 ? (
                suggestions.map((customer, index) => (
                  <CustomerSuggestionRow
                    key={customer.customerId}
                    customer={customer}
                    active={index === activeIndex}
                    inDraft={draftCustomerIds.has(customer.customerId)}
                    onSelect={onSelectCustomer}
                  />
                ))
              ) : (
                <div className="px-3 py-3 text-sm text-text-secondary">No matching route customer found.</div>
              )}
            </div>
          ) : null}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-secondary">Amount</span>
          <input
            ref={amountInputRef}
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onAddSelected();
              }

              if (event.key === "Escape") {
                onAmountChange("");
                searchInputRef.current?.focus();
              }
            }}
            disabled={disabled || !selectedCustomer}
            placeholder="0.00"
            className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-accent disabled:bg-surface-muted disabled:text-text-muted"
          />
        </label>

        <div className="flex items-center gap-2 xl:mt-6">
          <PrimaryButton
            type="button"
            disabled={disabled}
            icon={<PlusIcon className="h-4 w-4" />}
            className="h-10 rounded-md px-5 text-sm font-semibold"
            onClick={onAddSelected}
          >
            Add row
          </PrimaryButton>
          {canClearDraft ? (
            <SecondaryButton
              type="button"
              onClick={onClearDraft}
              className="h-10 rounded-md text-sm"
            >
              Clear draft
            </SecondaryButton>
          ) : null}
        </div>
      </div>

      {selectedCustomer ? (
        <div className="mt-3 grid gap-2 rounded-md border border-surface-border bg-surface-muted p-3 text-sm md:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Outstanding</p>
            <p className="mt-1 font-semibold text-text-primary">{formatMoney(selectedCustomer.openingOutstanding)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Monthly bill</p>
            <p className="mt-1 font-semibold text-text-primary">{formatMoney(selectedCustomer.monthlyBillAmount)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Already paid</p>
            <p className="mt-1 font-semibold text-text-primary">{formatMoney(selectedCustomer.alreadyPaid)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Pending</p>
            <p className="mt-1 font-semibold text-text-primary">{formatMoney(selectedCustomer.pendingAmount)}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function BulkPaymentEntryScreen({ payload }: { payload: BulkPaymentPayload }) {
  const [routeId, setRouteId] = useState(payload.selectedRouteId);
  const [month, setMonth] = useState(payload.selectedMonth);
  const [paymentDate, setPaymentDate] = useState(payload.selectedPaymentDate);
  const [mode, setMode] = useState("CASH");
  const [status, setStatus] = useState("VERIFIED");
  const [query, setQuery] = useState("");
  const [amount, setAmount] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [highlightedCustomerId, setHighlightedCustomerId] = useState<string | null>(null);
  const [draftRows, setDraftRows] = useState<DraftPaymentRow[]>([]);
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState(createBulkRoutePayments, initialState);

  const customerById = useMemo(
    () => new Map(payload.customers.map((customer) => [customer.customerId, customer])),
    [payload.customers],
  );
  const draftCustomerIds = useMemo(
    () => new Set(draftRows.map((row) => row.customerId)),
    [draftRows],
  );
  const selectedCustomer = selectedCustomerId ? customerById.get(selectedCustomerId) : undefined;
  const selectionDirty = routeId !== payload.selectedRouteId || month !== payload.selectedMonth;

  const suggestions = useMemo(() => {
    if (!payload.selectedRouteId || selectionDirty) {
      return [];
    }

    const cleanQuery = query.trim();
    const matches = cleanQuery
      ? payload.customers.filter((customer) => matchesCustomer(customer, cleanQuery))
      : payload.customers;

    return matches.slice(0, 12);
  }, [payload.customers, payload.selectedRouteId, query, selectionDirty]);

  const tableRows = useMemo(() => {
    return draftRows
      .map((row) => ({
        row,
        customer: customerById.get(row.customerId),
      }))
      .filter((row): row is { row: DraftPaymentRow; customer: BulkPaymentCustomerRow } =>
        Boolean(row.customer),
      )
      .sort((left, right) => left.customer.sequenceNo - right.customer.sequenceNo);
  }, [customerById, draftRows]);

  const hasInvalidRows = draftRows.some((row) => getPositiveAmount(row.amount) <= 0);
  const saveRows = tableRows.map(({ row }) => ({
    customerId: row.customerId,
    amount: Number(row.amount),
  }));
  const draftTotal = saveRows.reduce((sum, row) => sum + getPositiveAmount(String(row.amount)), 0);
  const canUseEntry = payload.dbConnected && !payload.error && !selectionDirty && payload.selectedRouteId !== "";
  const canSave = canUseEntry && draftRows.length > 0 && !hasInvalidRows && !pending;

  usePageMetric(
    draftRows.length > 0
      ? { label: "Draft", value: String(draftRows.length), tone: "warning" }
      : payload.selectedRouteId
        ? { label: "Route customers", value: String(payload.customers.length) }
        : null,
  );

  const showToast = useCallback((next: ToastState) => setToast(next), []);

  // Sync local editing state to a freshly (re)loaded route/month/date payload,
  // during render (React's "adjust state while rendering" pattern), keyed on
  // the loaded selection so it only runs when the server payload changes.
  const loadedSelectionKey = `${payload.selectedRouteId}|${payload.selectedMonth}|${payload.selectedPaymentDate}`;
  const [lastLoadedSelectionKey, setLastLoadedSelectionKey] = useState(loadedSelectionKey);
  if (loadedSelectionKey !== lastLoadedSelectionKey) {
    setLastLoadedSelectionKey(loadedSelectionKey);
    setRouteId(payload.selectedRouteId);
    setMonth(payload.selectedMonth);
    setPaymentDate(payload.selectedPaymentDate);
    setQuery("");
    setAmount("");
    setSelectedCustomerId(null);
    setDraftRows([]);
  }

  // Handle each completed save/action result once — toast it, and on success
  // clear the tally. Keyed on the message so it fires once per result.
  // Refocusing the search box is a DOM side effect handled in the effect below
  // (no setState there), keeping this render-time block setState-only.
  const actionResultKey = state.status !== "idle" && state.message ? `${state.status}:${state.message}` : null;
  const [processedActionKey, setProcessedActionKey] = useState<string | null>(null);
  if (actionResultKey && state.message && actionResultKey !== processedActionKey) {
    setProcessedActionKey(actionResultKey);
    setToast({
      tone: state.status === "success" ? "success" : "error",
      message: state.message,
    });
    if (state.status === "success") {
      setDraftRows([]);
      setQuery("");
      setAmount("");
      setSelectedCustomerId(null);
    }
  }

  // Refocus the search box after a successful save (DOM side effect only —
  // keyed on the processed result so it fires once per success).
  useEffect(() => {
    if (processedActionKey?.startsWith("success:")) {
      searchInputRef.current?.focus();
    }
  }, [processedActionKey]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setToast(null), 2600);

    return () => window.clearTimeout(timeout);
  }, [toast]);

  const highlightDraftRow = (customerId: string) => {
    setHighlightedCustomerId(customerId);
    window.setTimeout(() => {
      document.getElementById(`bulk-payment-row-${customerId}`)?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }, 40);
    window.setTimeout(() => setHighlightedCustomerId(null), 1800);
  };

  const selectCustomer = (customer: BulkPaymentCustomerRow) => {
    if (draftCustomerIds.has(customer.customerId)) {
      highlightDraftRow(customer.customerId);
      showToast({
        tone: "warning",
        message: "Customer already exists in this payment batch.",
      });
      setQuery("");
      setSelectedCustomerId(null);
      setAmount("");
      searchInputRef.current?.focus();
      return;
    }

    setSelectedCustomerId(customer.customerId);
    setQuery(customer.customerName);
    setAmount(getSuggestedAmount(customer));
    setSuggestionsOpen(false);
    setHighlightedIndex(0);
    window.setTimeout(() => {
      amountInputRef.current?.focus();
      amountInputRef.current?.select();
    }, 40);
  };

  const addSelectedCustomer = () => {
    const customer = selectedCustomer ?? suggestions[0];

    if (!customer) {
      showToast({
        tone: "warning",
        message: "Select a route customer first.",
      });
      searchInputRef.current?.focus();
      return;
    }

    if (!selectedCustomer) {
      selectCustomer(customer);
      return;
    }

    if (draftCustomerIds.has(customer.customerId)) {
      highlightDraftRow(customer.customerId);
      showToast({
        tone: "warning",
        message: "Customer already exists in this payment batch.",
      });
      return;
    }

    const paymentAmount = getPositiveAmount(amount);

    if (paymentAmount <= 0) {
      showToast({
        tone: "warning",
        message: "Enter a payment amount greater than zero.",
      });
      amountInputRef.current?.focus();
      return;
    }

    setDraftRows((currentRows) => [
      ...currentRows,
      {
        customerId: customer.customerId,
        amount: paymentAmount.toFixed(2),
      },
    ]);
    showToast({
      tone: "success",
      message: "Customer added to payment batch.",
    });
    setQuery("");
    setAmount("");
    setSelectedCustomerId(null);
    setSuggestionsOpen(false);
    setHighlightedIndex(0);
    window.setTimeout(() => searchInputRef.current?.focus(), 40);
  };

  const updateDraftAmount = (customerId: string, nextAmount: string) => {
    setDraftRows((currentRows) =>
      currentRows.map((row) =>
        row.customerId === customerId
          ? {
              ...row,
              amount: nextAmount,
            }
          : row,
      ),
    );
  };

  const removeDraftRow = (customerId: string) => {
    setDraftRows((currentRows) => currentRows.filter((row) => row.customerId !== customerId));
    showToast({
      tone: "info",
      message: "Draft row removed.",
    });
  };

  const clearDraftRows = () => {
    setDraftRows([]);
    setSelectedCustomerId(null);
    setQuery("");
    setAmount("");
    searchInputRef.current?.focus();
  };

  return (
    <>
      <section className="space-y-4 pb-20">
        <RouteMonthToolbar
          payload={payload}
          routeId={routeId}
          month={month}
          paymentDate={paymentDate}
          mode={mode}
          status={status}
          dirty={selectionDirty}
          onRouteIdChange={setRouteId}
          onMonthChange={setMonth}
          onPaymentDateChange={setPaymentDate}
          onModeChange={setMode}
          onStatusChange={setStatus}
        />

        <AddCustomerBar
          query={query}
          amount={amount}
          suggestionsOpen={suggestionsOpen}
          highlightedIndex={highlightedIndex}
          selectedCustomer={selectedCustomer}
          suggestions={suggestions}
          draftCustomerIds={draftCustomerIds}
          disabled={!canUseEntry || pending}
          searchInputRef={searchInputRef}
          amountInputRef={amountInputRef}
          onQueryChange={(value) => {
            setQuery(value);
            setSelectedCustomerId(null);
          }}
          onAmountChange={setAmount}
          onSuggestionsOpenChange={setSuggestionsOpen}
          onHighlightedIndexChange={setHighlightedIndex}
          onSelectCustomer={selectCustomer}
          onAddSelected={addSelectedCustomer}
          onClearDraft={clearDraftRows}
          canClearDraft={draftRows.length > 0 && !pending}
          routeCustomerCount={payload.customers.length}
          nextRow={draftRows.length + 1}
        />

        {canUseEntry && payload.customers.length === 0 ? (
          <EmptyState message="No active customers found in this route/month sequence. Build the monthly route sequence first." />
        ) : null}

        <section className="space-y-3">
          <DataTable
            columns={[
              { key: "sr", label: "Sr", className: "w-12" },
              { key: "customer", label: "Customer" },
              { key: "pending", label: "Pending", className: "w-28 text-right", headerClassName: "text-right" },
              { key: "amount", label: "Amount", className: "w-36 text-right", headerClassName: "text-right" },
              { key: "balance", label: "Balance", className: "w-28 text-right", headerClassName: "text-right" },
              { key: "action", label: "", className: "w-12 text-right", headerClassName: "text-right" },
            ]}
            rows={tableRows.map(({ row, customer }, index) => {
              const invalidAmount = getPositiveAmount(row.amount) <= 0;
              const balanceAfter = Number(customer.pendingAmount) - getPositiveAmount(row.amount);

              return {
                key: customer.customerId,
                className: highlightedCustomerId === customer.customerId ? "bg-accent-soft" : undefined,
                cells: [
                  <span key="sr" className="font-semibold text-text-secondary">
                    {index + 1}
                  </span>,
                  <div key="customer" id={`bulk-payment-row-${customer.customerId}`} className="min-w-[160px]">
                    <p className="text-sm font-semibold uppercase leading-5 text-text-primary">
                      {customer.customerName}
                    </p>
                    <p className="mt-0.5 text-xs font-medium uppercase tracking-[0.1em] text-text-secondary">
                      {formatCustomerMeta(customer) || "-"}
                    </p>
                  </div>,
                  <span key="pending" className="block text-right font-semibold text-text-primary">
                    {formatMoney(customer.pendingAmount)}
                  </span>,
                  <input
                    key="amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.amount}
                    onChange={(event) => updateDraftAmount(row.customerId, event.target.value)}
                    disabled={pending}
                    className={cn(
                      "h-9 w-full rounded-md border bg-surface px-3 text-right text-sm font-semibold text-text-primary outline-none transition focus:border-accent disabled:bg-surface-muted",
                      invalidAmount ? "border-rose-300" : "border-surface-border-strong",
                    )}
                    aria-label={`Payment amount for ${customer.customerName}`}
                  />,
                  <span
                    key="balance"
                    className={cn(
                      "block text-right font-semibold tabular-nums",
                      balanceAfter <= 0 ? "text-status-success-text" : "text-text-primary",
                    )}
                    title="Balance after this payment"
                  >
                    {formatMoney(balanceAfter)}
                  </span>,
                  <div key="action" className="flex justify-end">
                    <IconButton
                      type="button"
                      tone="danger"
                      disabled={pending}
                      aria-label={`Remove ${customer.customerName}`}
                      title="Remove draft row"
                      onClick={() => removeDraftRow(row.customerId)}
                    >
                      <XIcon className="h-5 w-5" />
                    </IconButton>
                  </div>,
                ],
              };
            })}
            emptyMessage="No payment rows added yet. Search a customer above and press Enter."
            minWidth="min-w-[620px]"
            className="rounded-md border-surface-border shadow-none"
            headClassName="bg-surface-muted/70"
            headerCellClassName="px-5 py-3"
            rowClassName="align-middle hover:bg-surface-muted/70"
            cellClassName="px-5 py-3"
          />
        </section>
      </section>

      <form id="bulk-route-payment-form" action={formAction}>
        <input type="hidden" name="routeId" value={payload.selectedRouteId} readOnly />
        <input type="hidden" name="billingMonth" value={payload.selectedMonth} readOnly />
        <input type="hidden" name="paymentDate" value={paymentDate} readOnly />
        <input type="hidden" name="mode" value={mode} readOnly />
        <input type="hidden" name="status" value={status} readOnly />
        <input type="hidden" name="referenceNo" value={referenceNo} readOnly />
        <input type="hidden" name="notes" value={notes} readOnly />
        <input type="hidden" name="entriesJson" value={JSON.stringify(saveRows)} readOnly />
      </form>

      {draftRows.length > 0 ? (
        <StickyActionBar>
          <div className="mr-auto hidden items-center gap-3 md:flex">
            <span className="text-sm font-semibold text-text-primary">
              {draftRows.length} payments · {formatMoney(draftTotal)}
            </span>
            {hasInvalidRows ? <span className="text-sm font-medium text-rose-700">Fix invalid amounts</span> : null}
            {state.status === "error" && state.message ? (
              <span className="text-sm font-medium text-rose-700">{state.message}</span>
            ) : null}
          </div>
          <label className="hidden min-w-56 flex-col gap-1 md:flex">
            <span className="text-xs font-medium text-text-secondary">Reference</span>
            <input
              value={referenceNo}
              onChange={(event) => setReferenceNo(event.target.value)}
              disabled={pending}
              placeholder="Optional"
              className="h-9 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            />
          </label>
          <label className="hidden min-w-64 flex-col gap-1 lg:flex">
            <span className="text-xs font-medium text-text-secondary">Notes</span>
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={pending}
              placeholder="Optional batch note"
              className="h-9 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            />
          </label>
          <PrimaryButton
            type="submit"
            form="bulk-route-payment-form"
            disabled={!canSave}
            icon={pending ? <LoadingSpinner /> : undefined}
            className="h-10 rounded-md px-5 text-sm font-semibold"
          >
            {pending ? "Saving..." : "Save All"}
          </PrimaryButton>
        </StickyActionBar>
      ) : null}

      {toast ? <Toast tone={toast.tone}>{toast.message}</Toast> : null}
    </>
  );
}
