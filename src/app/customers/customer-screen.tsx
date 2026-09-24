"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { CustomerRecord, CustomersPayload } from "@/lib/masters";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { createCustomer, setCustomerActiveState, type ActionState, updateCustomer } from "@/app/masters/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { DataTable } from "@/components/admin/data-table";
import { Dialog } from "@/components/admin/dialog";
import { FormInput } from "@/components/admin/form-input";
import { HighlightMatch } from "@/components/admin/highlight-match";
import { IconButton } from "@/components/admin/icon-button";
import { useLoadingBar } from "@/components/admin/loading-bar";
import { PencilSquareIcon, PlusIcon, RouteIcon } from "@/components/admin/icons";
import { KeyboardForm } from "@/components/admin/keyboard-form";
import { usePageMetric } from "@/components/admin/page-metric";
import { PageActions } from "@/components/admin/page-actions";
import { Pagination } from "@/components/admin/pagination";
import { PillToggle } from "@/components/admin/pill-toggle";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";
import { StatusBadge } from "@/components/admin/status-badge";

const initialState: ActionState = { status: "idle" };

type CustomerScreenProps = {
  payload: CustomersPayload;
};

type CustomerDialogMode = "create" | "edit" | null;

type CustomerDraft = {
  id?: string;
  code: string;
  name: string;
  area: string;
  mobile: string;
  openingBalance: string;
};

const emptyDraft: CustomerDraft = {
  code: "",
  name: "",
  area: "",
  mobile: "",
  openingBalance: "0",
};

function normalizeDraft(draft: CustomerDraft) {
  return {
    code: draft.code.trim(),
    name: draft.name.trim(),
    area: draft.area.trim(),
    mobile: draft.mobile.trim(),
    openingBalance: draft.openingBalance.trim(),
  };
}

function getDraftFromForm(formData: FormData): CustomerDraft {
  return {
    code: String(formData.get("code") ?? ""),
    name: String(formData.get("name") ?? ""),
    area: String(formData.get("area") ?? ""),
    mobile: String(formData.get("mobile") ?? ""),
    openingBalance: String(formData.get("openingBalance") ?? ""),
  };
}

// Controlled, not defaultValue. React resets an uncontrolled form once its
// action returns, so on a duplicate-name warning the operator's typed name and
// area vanished at exactly the moment they needed to read them and decide.
function CustomerFormFields({
  values,
  onChange,
  mode,
}: {
  values: CustomerDraft;
  onChange: (field: keyof CustomerDraft, value: string) => void;
  mode: CustomerDialogMode;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {mode === "edit" ? (
        <FormInput
          label="Code"
          name="code"
          placeholder="CUS-104"
          value={values.code}
          onChange={(event) => onChange("code", event.target.value)}
        />
      ) : null}
      <FormInput
        label="Name"
        name="name"
        placeholder="Deepak Meena"
        value={values.name}
        onChange={(event) => onChange("name", event.target.value)}
        autoFocus={mode === "create"}
      />
      <FormInput
        label="Area"
        name="area"
        placeholder="Mansarovar"
        value={values.area}
        onChange={(event) => onChange("area", event.target.value)}
      />
      <FormInput
        label="Mobile"
        name="mobile"
        placeholder="98290 11224"
        value={values.mobile}
        onChange={(event) => onChange("mobile", event.target.value)}
      />
      <div className="md:col-span-2">
        <FormInput
          label="Opening balance"
          name="openingBalance"
          type="number"
          step="0.01"
          placeholder="0"
          value={values.openingBalance}
          onChange={(event) => onChange("openingBalance", event.target.value)}
        />
      </div>
    </div>
  );
}

function CustomerDialog({
  open,
  mode,
  dbConnected,
  customer,
  onClose,
}: {
  open: boolean;
  mode: "create" | "edit";
  dbConnected: boolean;
  customer?: CustomerRecord;
  onClose: () => void;
}) {
  // The parent mounts this dialog fresh on every open, so the initializer is
  // the reset — the next customer is always a fresh decision.
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [createState, createAction, createPending] = useActionState(createCustomer, initialState);
  const [updateState, updateAction, updatePending] = useActionState(updateCustomer, initialState);

  const state = mode === "create" ? createState : updateState;
  const pending = mode === "create" ? createPending : updatePending;

  useEffect(() => {
    if (open && state.status === "success") {
      onClose();
    }
  }, [onClose, open, state.status]);

  const draft: CustomerDraft =
    mode === "edit" && customer
      ? {
          id: customer.id,
          code: customer.code,
          name: customer.name,
          area: customer.area ?? "",
          mobile: customer.mobile ?? "",
          openingBalance: customer.openingBalance,
        }
      : emptyDraft;
  const normalizedDraft = normalizeDraft(draft);

  // Seeded once — the dialog is mounted fresh on every open, so this holds the
  // operator's typing across a failed submit instead of losing it to React's
  // post-action form reset.
  const [values, setValues] = useState<CustomerDraft>(draft);
  const updateField = (field: keyof CustomerDraft, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "create" ? "Add customer" : "Edit customer"}
      description={
        mode === "create"
          ? "Create a customer record for route allocation, daily entry, payments, and billing."
          : "Update the customer details used across operations."
      }
      footer={null}
    >
      <KeyboardForm
        id={mode === "create" ? "customer-create-form" : "customer-edit-form"}
        action={mode === "create" ? createAction : updateAction}
        className="space-y-4"
        onSubmit={(event) => {
          if (mode !== "edit") {
            return;
          }

          const nextDraft = normalizeDraft(getDraftFromForm(new FormData(event.currentTarget)));
          const hasChanges =
            nextDraft.code !== normalizedDraft.code ||
            nextDraft.name !== normalizedDraft.name ||
            nextDraft.area !== normalizedDraft.area ||
            nextDraft.mobile !== normalizedDraft.mobile ||
            nextDraft.openingBalance !== normalizedDraft.openingBalance;

          if (!hasChanges) {
            event.preventDefault();
            onClose();
          }
        }}
      >
        {mode === "edit" && draft.id ? <input type="hidden" name="id" value={draft.id} /> : null}
        {/* Set once the operator has seen the existing customers below and
            still wants a new record. Cleared whenever the dialog reopens,
            because the next customer is a fresh decision. */}
        <input type="hidden" name="confirmDuplicate" value={confirmDuplicate ? "true" : "false"} readOnly />
        <CustomerFormFields values={values} onChange={updateField} mode={mode} />
        {state.status !== "idle" && state.message ? (
          <p className={`text-sm ${state.status === "success" ? "text-emerald-700" : "text-rose-700"}`}>
            {state.message}
          </p>
        ) : null}

        {/* Who you might be duplicating, with what actually tells them apart.
            Names collide constantly here — RAHUL is four different people — so
            this lists them rather than refusing outright. */}
        {state.duplicates && state.duplicates.length > 0 ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Already in this city</p>
            <ul className="mt-2 divide-y divide-amber-200">
              {state.duplicates.map((duplicate) => (
                <li key={duplicate.code} className="py-1.5 text-sm text-amber-900">
                  <span className="font-semibold">{duplicate.name}</span>
                  <span className="text-amber-800">
                    {duplicate.area ? ` · ${duplicate.area}` : " · no area"}
                    {duplicate.round ? ` · ${duplicate.round}` : " · not on a round"}
                  </span>
                </li>
              ))}
            </ul>
            <label className="mt-3 flex items-start gap-2 text-sm text-amber-900">
              <input
                type="checkbox"
                checked={confirmDuplicate}
                onChange={(event) => setConfirmDuplicate(event.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>This is a different person — add them anyway.</span>
            </label>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-surface-border pt-4">
          <StatusBadge tone={dbConnected ? "success" : "warning"}>
            {dbConnected ? "Live data" : "Offline fallback"}
          </StatusBadge>
          <SecondaryButton type="button" onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={pending}>
            {pending ? "Saving..." : mode === "create" ? "Save customer" : "Update customer"}
          </PrimaryButton>
        </div>
      </KeyboardForm>
    </Dialog>
  );
}

function CustomerRowActions({ onEdit }: { onEdit: () => void }) {
  return (
    <div className="flex items-center justify-end">
      <IconButton type="button" onClick={onEdit} aria-label="Edit customer" title="Edit customer">
        <PencilSquareIcon className="h-[18px] w-[18px]" />
      </IconButton>
    </div>
  );
}

function formatSequenceMonth(month: string) {
  return new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
}

// billsHere marks the route that carries a multi-route customer's single
// combined bill (see MonthlyRouteCustomerSequence). Nothing route-related
// shows in the row itself — wraps the name cell so hovering anywhere over a
// customer's name/code/area reveals it, instead of a permanent column or
// indicator every row pays for whether or not it's being looked at.
function CustomerRouteHoverCard({ customer, children }: { customer: CustomerRecord; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  if (customer.routes.length === 0) {
    return <>{children}</>;
  }

  const showCard = () => {
    const bounds = anchorRef.current?.getBoundingClientRect();
    if (bounds) {
      setRect({ top: bounds.bottom + 4, left: bounds.left });
    }
    setOpen(true);
  };

  return (
    <div ref={anchorRef} className="cursor-default" onMouseEnter={showCard} onMouseLeave={() => setOpen(false)}>
      {children}
      {open && rect ? (
        <div
          className="fixed z-50 w-64 rounded-lg border border-surface-border-strong bg-surface p-3 shadow-lg"
          style={{ top: rect.top, left: rect.left }}
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-text-secondary">
            <RouteIcon className="h-3.5 w-3.5" />
            <span className="text-xs font-semibold uppercase tracking-wide">
              {customer.routes.length > 1 ? `${customer.routes.length} routes` : "Route"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {customer.routes.map((route) => (
              <StatusBadge key={route.routeId} tone={route.billsHere ? "info" : "neutral"}>
                {route.routeName}
                {route.billsHere && customer.routes.length > 1 ? " · bills here" : ""}
              </StatusBadge>
            ))}
          </div>
          {!customer.isCurrentMonth && customer.sequenceMonth ? (
            <p className="mt-1.5 text-xs text-text-secondary">
              Last active {formatSequenceMonth(customer.sequenceMonth)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CustomerStatusToggle({ customer }: { customer: CustomerRecord }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [state, action, pending] = useActionState(async (prevState: ActionState, formData: FormData) => {
    const result = await setCustomerActiveState(prevState, formData);

    if (result.status === "success") {
      setConfirmOpen(false);
      setSubmitted(false);
    }

    return result;
  }, initialState);
  const nextStateLabel = customer.isActive ? "inactive" : "active";

  const closeConfirm = () => {
    if (!pending) {
      setConfirmOpen(false);
      setSubmitted(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <PillToggle
        type="button"
        active={customer.isActive}
        pending={pending}
        onClick={() => {
          setSubmitted(false);
          setConfirmOpen(true);
        }}
        aria-label={customer.isActive ? "Make inactive" : "Make active"}
        title={customer.isActive ? "Make inactive" : "Make active"}
      />
      <ConfirmDialog
        open={confirmOpen}
        onClose={closeConfirm}
        title={customer.isActive ? "Make customer inactive?" : "Activate customer?"}
        description={`This will mark ${customer.name} as ${nextStateLabel}.`}
        confirmLabel={customer.isActive ? "Make inactive" : "Activate"}
        pending={pending}
        action={action}
        onSubmit={() => setSubmitted(true)}
      >
        <input type="hidden" name="id" value={customer.id} />
        <input type="hidden" name="isActive" value={customer.isActive ? "false" : "true"} />
        <span className="text-sm text-text-secondary mb-4 block">
          {customer.isActive
            ? "This customer will no longer be available for route allocation, daily entry, and billing."
            : "This customer will be available for route allocation, daily entry, and billing."}
        </span>
        {submitted && state.status === "error" && state.message ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {state.message}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

export function CustomerScreen({ payload }: CustomerScreenProps) {
  const { customers, dbConnected, total, page, pageSize, routeOptions: routeOptionRows } = payload;

  const { navigate } = useLoadingBar();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlSearch = searchParams.get("search") ?? "";
  const urlRouteId = searchParams.get("routeId") ?? "";
  const urlStatus = searchParams.get("status") ?? "";

  // Typing updates this immediately (so the input feels responsive) and the
  // URL — which is what actually triggers the server query — only after it
  // settles. Route/status changes go straight to the URL: they're discrete
  // choices, not something to debounce.
  const [searchInput, setSearchInput] = useState(urlSearch);
  const debouncedSearch = useDebouncedValue(searchInput, 350);

  const [dialogMode, setDialogMode] = useState<CustomerDialogMode>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId),
    [customers, selectedCustomerId],
  );

  const routeOptions = useMemo(
    () => routeOptionRows.map((route) => ({ value: route.id, label: route.name })),
    [routeOptionRows],
  );

  const updateParams = useCallback(
    (next: Record<string, string>, options?: { resetPage?: boolean }) => {
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
    },
    [navigate, pathname, searchParams],
  );

  // Fires once the debounced value actually differs from what's in the URL
  // — typing that lands back on the current search (e.g. type then undo)
  // shouldn't trigger a request.
  useEffect(() => {
    if (debouncedSearch !== urlSearch) {
      updateParams({ search: debouncedSearch });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // The URL is the source of truth; a change from outside typing (Clear
  // button, back/forward navigation) needs to be reflected in the input.
  // Adjusted during render (not an effect) to avoid an extra render pass —
  // same pattern as usePagination's resetKey handling.
  const [lastUrlSearch, setLastUrlSearch] = useState(urlSearch);
  if (urlSearch !== lastUrlSearch) {
    setLastUrlSearch(urlSearch);
    setSearchInput(urlSearch);
  }

  const hasActiveFilters = urlSearch.trim() !== "" || urlRouteId !== "" || urlStatus !== "";

  usePageMetric({ label: "Customers", value: String(total) });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIndex = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, total);

  const resetFilters = () => {
    setSearchInput("");
    navigate(pathname, { replace: true, scroll: false });
  };

  const closeDialog = () => {
    setDialogMode(null);
    setSelectedCustomerId(null);
  };

  const openCreateDialog = () => {
    setSelectedCustomerId(null);
    setDialogMode("create");
  };

  const openEditDialog = (customerId: string) => {
    setSelectedCustomerId(customerId);
    setDialogMode("edit");
  };

  return (
    <>
      <PageActions>
        <Link
          href="/customers/map"
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-surface-border-strong bg-surface px-4 text-sm font-semibold text-text-secondary transition hover:bg-surface-muted"
        >
          Map
        </Link>
        <Link
          href="/customers/bulk-add"
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-surface-border-strong bg-surface px-4 text-sm font-semibold text-text-secondary transition hover:bg-surface-muted"
        >
          Bulk add
        </Link>
        <PrimaryButton
          type="button"
          onClick={openCreateDialog}
          icon={<PlusIcon className="h-4 w-4" />}
          className="h-10 shrink-0 rounded-md px-5 text-sm font-semibold"
        >
          Add Customer
        </PrimaryButton>
      </PageActions>

      <section className="space-y-4">
        <div className="sticky top-[65px] z-10 -mx-4 flex flex-col gap-3 border-b border-surface-border bg-app-bg/95 px-4 py-3 backdrop-blur transition-colors duration-200 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid w-full gap-3 md:grid-cols-[minmax(220px,1fr)_200px_170px] xl:max-w-[760px]">
            <SearchInput
              name="search"
              placeholder="Search by name, code, area, or phone"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            <SelectInput
              name="route"
              value={urlRouteId}
              onChange={(event) => updateParams({ routeId: event.target.value })}
              placeholder="All sequence routes"
              options={routeOptions}
              className="h-10 rounded-md bg-surface text-sm"
            />
            <SelectInput
              name="status"
              value={urlStatus}
              onChange={(event) => updateParams({ status: event.target.value })}
              placeholder="All customers"
              options={[
                { value: "ACTIVE", label: "Active" },
                { value: "INACTIVE", label: "Inactive" },
              ]}
              className="h-10 rounded-md bg-surface text-sm"
            />
          </div>
          {/* Only filter-scoped controls live here. The page-level actions moved
              to PageActions above — cramming both into one row made the primary
              action wrap onto its own line once a fourth button appeared.
              Rendered conditionally because an empty flex child still consumes
              the parent's gap and leaves a dead band under the filters. */}
          {!dbConnected || hasActiveFilters ? (
            <div className="flex shrink-0 items-center gap-2">
              {dbConnected ? null : <StatusBadge tone="warning">Offline fallback</StatusBadge>}
              {hasActiveFilters ? (
                <SecondaryButton
                  type="button"
                  onClick={resetFilters}
                  className="h-10 shrink-0 px-4 text-sm font-medium"
                >
                  Clear
                </SecondaryButton>
              ) : null}
            </div>
          ) : null}
        </div>

        <DataTable
          columns={[
            { key: "name", label: "Name", className: "w-1" },
            { key: "phone", label: "Phone", className: "w-2" },
            { key: "status", label: "Status", className: "w-3" },
            {
              key: "actions",
              label: "Actions",
              className: "w-4 text-right",
              headerClassName: "text-right",
            },
          ]}
          rows={customers.map((customer) => ({
            key: customer.id,
            cells: [
              <div key="name" className="min-w-[260px]">
                <CustomerRouteHoverCard customer={customer}>
                  <p className="text-[15px] font-semibold leading-6 text-text-primary">
                    <HighlightMatch text={customer.name} query={urlSearch} />
                  </p>
                  <p className="mt-0.5 text-sm text-text-secondary">
                    <HighlightMatch text={customer.code} query={urlSearch} />
                    {customer.area ? (
                      <>
                        {" · "}
                        <HighlightMatch text={customer.area} query={urlSearch} />
                      </>
                    ) : null}
                  </p>
                </CustomerRouteHoverCard>
              </div>,
              <span key="phone" className="text-sm text-text-primary">
                {customer.mobile ? <HighlightMatch text={customer.mobile} query={urlSearch} /> : "-"}
              </span>,
              <CustomerStatusToggle key="status" customer={customer} />,
              <CustomerRowActions
                key="actions"
                onEdit={() => {
                  openEditDialog(customer.id);
                }}
              />,
            ],
          }))}
          emptyMessage="No customers match the selected filters"
          minWidth="min-w-[640px]"
          className="rounded-md border-surface-border shadow-none"
          headClassName="bg-surface-muted/70"
          headerCellClassName="px-5 py-3"
          rowClassName="align-middle hover:bg-surface-muted/60"
          cellClassName="px-5 py-3.5"
        />

        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          startIndex={startIndex}
          endIndex={endIndex}
          onPageChange={(nextPage) => updateParams({ page: String(nextPage) }, { resetPage: false })}
          itemLabel="customers"
        />
      </section>

      {dialogMode === "create" ? (
        <CustomerDialog open mode="create" dbConnected={dbConnected} onClose={closeDialog} />
      ) : null}

      {dialogMode === "edit" && selectedCustomer ? (
        <CustomerDialog open mode="edit" dbConnected={dbConnected} customer={selectedCustomer} onClose={closeDialog} />
      ) : null}
    </>
  );
}
