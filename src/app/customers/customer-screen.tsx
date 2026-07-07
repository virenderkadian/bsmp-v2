"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type { CustomerRecord } from "@/lib/masters";
import { createCustomer, setCustomerActiveState, type ActionState, updateCustomer } from "@/app/masters/actions";
import { PrimaryButton, SecondaryButton, ActionButton } from "@/components/admin/buttons";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { DataTable } from "@/components/admin/data-table";
import { Dialog } from "@/components/admin/dialog";
import { FormInput } from "@/components/admin/form-input";
import { EditIcon, PlusIcon } from "@/components/admin/icons";
import { KeyboardForm } from "@/components/admin/keyboard-form";
import { PageHeader } from "@/components/admin/page-header";
import { PillToggle } from "@/components/admin/pill-toggle";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";
import { StatusBadge } from "@/components/admin/status-badge";

const initialState: ActionState = { status: "idle" };

type CustomerScreenProps = {
  customers: CustomerRecord[];
  dbConnected: boolean;
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

function CustomerFormFields({ draft }: { draft: CustomerDraft }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormInput label="Code" name="code" placeholder="CUS-104" defaultValue={draft.code} autoFocus />
      <FormInput label="Name" name="name" placeholder="Deepak Meena" defaultValue={draft.name} />
      <FormInput label="Area" name="area" placeholder="Mansarovar" defaultValue={draft.area} />
      <FormInput label="Mobile" name="mobile" placeholder="98290 11224" defaultValue={draft.mobile} />
      <div className="md:col-span-2">
        <FormInput
          label="Opening balance"
          name="openingBalance"
          type="number"
          step="0.01"
          placeholder="0"
          defaultValue={draft.openingBalance}
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
        <CustomerFormFields draft={draft} />
        {state.status !== "idle" && state.message ? (
          <p className={`text-sm ${state.status === "success" ? "text-emerald-700" : "text-rose-700"}`}>
            {state.message}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-4">
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
      <ActionButton
        type="button"
        icon={<EditIcon className="h-[18px] w-[18px]" />}
        onClick={onEdit}
        className="h-8 w-8 rounded-md border-none bg-transparent px-0 text-slate-900 shadow-none hover:bg-slate-100"
        aria-label="Edit customer"
        title="Edit customer"
      >
        <span className="sr-only">Edit</span>
      </ActionButton>
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
        <span className="text-sm text-slate-500 mb-4 block">
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

export function CustomerScreen({ customers, dbConnected }: CustomerScreenProps) {
  const [search, setSearch] = useState("");
  const [routeId, setRouteId] = useState("");
  const [status, setStatus] = useState("");
  const [dialogMode, setDialogMode] = useState<CustomerDialogMode>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId),
    [customers, selectedCustomerId],
  );

  const routeOptions = useMemo(() => {
    const uniqueRoutes = new Map<string, string>();

    customers.forEach((customer) => {
      if (customer.sequenceRouteId && customer.sequenceRouteName) {
        uniqueRoutes.set(customer.sequenceRouteId, customer.sequenceRouteName);
      }
    });

    return Array.from(uniqueRoutes.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    return customers.filter((customer) => {
      const matchesSearch =
        search.trim() === "" ||
        customer.name.toLowerCase().includes(search.toLowerCase()) ||
        (customer.area ?? "").toLowerCase().includes(search.toLowerCase());

      const matchesRoute = routeId === "" || customer.sequenceRouteId === routeId;

      const matchesStatus = status === "" || (status === "ACTIVE" ? customer.isActive : !customer.isActive);

      return matchesSearch && matchesRoute && matchesStatus;
    });
  }, [customers, routeId, search, status]);

  const hasActiveFilters = search.trim() !== "" || routeId !== "" || status !== "";

  const resetFilters = () => {
    setSearch("");
    setRouteId("");
    setStatus("");
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
      <PageHeader
        title="Customer Master"
        subtitle="Manage customers"
        actions={
          <button
            type="button"
            onClick={openCreateDialog}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-blue-600 bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <PlusIcon className="h-4 w-4" />
            Add Customer
          </button>
        }
      />

      <section className="space-y-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid w-full gap-3 md:grid-cols-[minmax(280px,1fr)_220px_180px] xl:max-w-[960px]">
            <SearchInput
              name="search"
              placeholder="Search by name or area"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <SelectInput
              name="route"
              value={routeId}
              onChange={(event) => setRouteId(event.target.value)}
              placeholder="All sequence routes"
              options={routeOptions}
              className="h-10 rounded-md bg-white text-sm"
            />
            <SelectInput
              name="status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              placeholder="All customers"
              options={[
                { value: "ACTIVE", label: "Active" },
                { value: "INACTIVE", label: "Inactive" },
              ]}
              className="h-10 rounded-md bg-white text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            {dbConnected ? null : <StatusBadge tone="warning">Offline fallback</StatusBadge>}
            {hasActiveFilters ? (
              <SecondaryButton type="button" onClick={resetFilters} className="h-10 px-4 text-sm font-medium">
                Clear
              </SecondaryButton>
            ) : null}
          </div>
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
          rows={filteredCustomers.map((customer) => ({
            key: customer.id,
            cells: [
              <div key="name" className="min-w-[260px]">
                <p className="text-[15px] font-semibold leading-6 text-slate-900">{customer.name}</p>
                {customer.area ? <p className="mt-0.5 text-sm text-slate-500">{customer.area}</p> : null}
              </div>,
              <span key="phone" className="text-sm text-slate-800">
                {customer.mobile || "-"}
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
          minWidth="min-w-[760px]"
          className="rounded-md border-slate-200 shadow-none"
          headClassName="bg-slate-100/70"
          headerCellClassName="px-5 py-3"
          rowClassName="align-middle hover:bg-slate-50/60"
          cellClassName="px-5 py-3.5"
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
