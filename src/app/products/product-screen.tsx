"use client";

import { useActionState, useEffect, useMemo, useState, type FormEvent } from "react";
import { createProduct, setProductActiveState, type ActionState, updateProduct } from "@/app/masters/actions";
import { ActiveStatusToggle } from "@/components/admin/active-status-toggle";
import { ActionButton, PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { DataTable } from "@/components/admin/data-table";
import { Dialog } from "@/components/admin/dialog";
import { FormInput } from "@/components/admin/form-input";
import { EditIcon, PlusIcon } from "@/components/admin/icons";
import { KeyboardForm } from "@/components/admin/keyboard-form";
import { PageHeader } from "@/components/admin/page-header";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";
import { StatusBadge } from "@/components/admin/status-badge";
import type { ProductRecord } from "@/lib/masters";

const initialState: ActionState = { status: "idle" };

type ProductScreenProps = {
  dbConnected: boolean;
  products: ProductRecord[];
};

type ProductDraft = {
  id?: string;
  code: string;
  name: string;
  shortName: string;
  unit: string;
  defaultRate: string;
  displayOrder: string;
  showInDailyEntry: boolean;
  includeInReconciliation: boolean;
};

const baseEmptyProductDraft: ProductDraft = {
  code: "",
  name: "",
  shortName: "",
  unit: "",
  defaultRate: "",
  displayOrder: "0",
  showInDailyEntry: true,
  includeInReconciliation: false,
};

function normalizeText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRate(value: FormDataEntryValue | null) {
  const rate = Number(normalizeText(value));
  return Number.isFinite(rate) ? rate : Number.NaN;
}

function normalizeBoolean(value: FormDataEntryValue | null) {
  return normalizeText(value) === "true";
}

function formatRate(rate: string) {
  const amount = Number(rate);

  if (!Number.isFinite(amount)) {
    return "₹0";
  }

  return `₹${amount.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  })}`;
}

function ProductDialog({
  open,
  mode,
  dbConnected,
  draft,
  onClose,
}: {
  open: boolean;
  mode: "create" | "edit";
  dbConnected: boolean;
  draft: ProductDraft;
  onClose: () => void;
}) {
  const [createState, createAction, createPending] = useActionState(createProduct, initialState);
  const [updateState, updateAction, updatePending] = useActionState(updateProduct, initialState);
  const state = mode === "create" ? createState : updateState;
  const pending = mode === "create" ? createPending : updatePending;

  useEffect(() => {
    if (open && state.status === "success") {
      onClose();
    }
  }, [onClose, open, state.status]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (mode !== "edit") {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const hasChanges =
      normalizeText(formData.get("code")) !== draft.code ||
      normalizeText(formData.get("name")) !== draft.name ||
      normalizeText(formData.get("shortName")) !== draft.shortName ||
      normalizeText(formData.get("unit")) !== draft.unit ||
      normalizeRate(formData.get("defaultRate")) !== Number(draft.defaultRate) ||
      normalizeRate(formData.get("displayOrder")) !== Number(draft.displayOrder) ||
      normalizeBoolean(formData.get("showInDailyEntry")) !== draft.showInDailyEntry ||
      normalizeBoolean(formData.get("includeInReconciliation")) !== draft.includeInReconciliation;

    if (!hasChanges) {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "create" ? "Add product" : "Edit product"}
      description="Maintain product names, units, and default rates used in daily entry and billing."
      footer={null}
    >
      <KeyboardForm
        action={mode === "create" ? createAction : updateAction}
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        {mode === "edit" && draft.id ? <input type="hidden" name="id" value={draft.id} /> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <FormInput label="Code" name="code" placeholder="B" defaultValue={draft.code} autoFocus />
          <FormInput label="Product name" name="name" placeholder="Buffalo Milk" defaultValue={draft.name} />
          <FormInput label="Short name" name="shortName" placeholder="Buff" defaultValue={draft.shortName} />
          <FormInput label="Unit" name="unit" placeholder="Litre" defaultValue={draft.unit} />
          <FormInput
            label="Default rate"
            name="defaultRate"
            type="number"
            step="0.01"
            min="0"
            placeholder="60"
            defaultValue={draft.defaultRate}
          />
          <FormInput
            label="Display order"
            name="displayOrder"
            type="number"
            min="0"
            step="1"
            placeholder="1"
            defaultValue={draft.displayOrder}
          />
          <SelectInput
            label="Daily Entry column"
            name="showInDailyEntry"
            defaultValue={draft.showInDailyEntry ? "true" : "false"}
            options={[
              { value: "true", label: "Show in Daily Entry" },
              { value: "false", label: "Hide from Daily Entry" },
            ]}
          />
          <SelectInput
            label="Reconciliation"
            name="includeInReconciliation"
            defaultValue={draft.includeInReconciliation ? "true" : "false"}
            options={[
              { value: "true", label: "Included in vehicle reconciliation" },
              { value: "false", label: "Not part of reconciliation" },
            ]}
          />
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
            {pending ? "Saving..." : mode === "create" ? "Save product" : "Update product"}
          </PrimaryButton>
        </div>
      </KeyboardForm>
    </Dialog>
  );
}

export function ProductScreen({ dbConnected, products }: ProductScreenProps) {
  const [search, setSearch] = useState("");
  const [unit, setUnit] = useState("");
  const [status, setStatus] = useState("");
  const [dailyEntryVisibility, setDailyEntryVisibility] = useState("");
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  const selectedProduct = products.find((product) => product.id === selectedProductId);
  const nextDisplayOrder = products.reduce((max, product) => Math.max(max, product.displayOrder), 0) + 1;
  const emptyProductDraft: ProductDraft = {
    ...baseEmptyProductDraft,
    displayOrder: String(nextDisplayOrder),
  };
  const productDraft: ProductDraft = selectedProduct
    ? {
        id: selectedProduct.id,
        code: selectedProduct.code,
        name: selectedProduct.name,
        shortName: selectedProduct.shortName ?? "",
        unit: selectedProduct.unit,
        defaultRate: selectedProduct.defaultRate,
        displayOrder: String(selectedProduct.displayOrder),
        showInDailyEntry: selectedProduct.showInDailyEntry,
        includeInReconciliation: selectedProduct.includeInReconciliation,
      }
    : emptyProductDraft;

  const unitOptions = useMemo(() => {
    return Array.from(new Set(products.map((product) => product.unit).filter(Boolean)))
      .sort((first, second) => first.localeCompare(second))
      .map((productUnit) => ({
        value: productUnit,
        label: productUnit,
      }));
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const query = search.toLowerCase().trim();
      const matchesSearch =
        query === "" ||
        product.code.toLowerCase().includes(query) ||
        product.name.toLowerCase().includes(query) ||
        (product.shortName ?? "").toLowerCase().includes(query);
      const matchesUnit = unit === "" || product.unit === unit;
      const matchesStatus = status === "" || (status === "ACTIVE" ? product.isActive : !product.isActive);
      const matchesDailyEntry =
        dailyEntryVisibility === "" ||
        (dailyEntryVisibility === "SHOWN" ? product.showInDailyEntry : !product.showInDailyEntry);

      return matchesSearch && matchesUnit && matchesStatus && matchesDailyEntry;
    });
  }, [dailyEntryVisibility, products, search, status, unit]);

  const hasActiveFilters = search.trim() !== "" || unit !== "" || status !== "" || dailyEntryVisibility !== "";

  const resetFilters = () => {
    setSearch("");
    setUnit("");
    setStatus("");
    setDailyEntryVisibility("");
  };

  const closeDialog = () => {
    setDialogMode(null);
    setSelectedProductId(null);
  };

  return (
    <>
      <PageHeader
        actions={
          <PrimaryButton
            type="button"
            icon={<PlusIcon className="h-4 w-4" />}
            className="h-10 rounded-md px-5 text-sm font-semibold"
            onClick={() => {
              setSelectedProductId(null);
              setDialogMode("create");
            }}
          >
            Add product
          </PrimaryButton>
        }
        title="Products & Rates"
        subtitle="Manage product catalog, units, and default billing rates."
      />

      <section className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="grid w-full gap-3 md:grid-cols-[minmax(260px,1fr)_150px_190px_160px] xl:max-w-5xl">
          <SearchInput
            name="search"
            placeholder="Search product"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <SelectInput
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            placeholder="All units"
            options={unitOptions}
            className="h-10 rounded-md bg-surface text-sm"
          />
          <SelectInput
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            placeholder="All statuses"
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "INACTIVE", label: "Inactive" },
            ]}
            className="h-10 rounded-md bg-surface text-sm"
          />
          <SelectInput
            value={dailyEntryVisibility}
            onChange={(event) => setDailyEntryVisibility(event.target.value)}
            placeholder="Daily Entry"
            options={[
              { value: "SHOWN", label: "Shown in Daily Entry" },
              { value: "HIDDEN", label: "Hidden from Daily Entry" },
            ]}
            className="h-10 rounded-md bg-surface text-sm"
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
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Product rate directory</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Showing {filteredProducts.length} of {products.length} products
          </p>
        </div>
        <DataTable
          columns={[
            { key: "product", label: "Product" },
            { key: "unit", label: "Unit" },
            { key: "order", label: "Order", className: "text-right", headerClassName: "text-right" },
            { key: "dailyEntry", label: "Daily Entry" },
            { key: "reconciliation", label: "Reconciliation" },
            { key: "rate", label: "Default Rate", className: "text-right", headerClassName: "text-right" },
            { key: "status", label: "Status" },
            {
              key: "actions",
              label: "Actions",
              className: "text-right",
              headerClassName: "text-right",
            },
          ]}
          rows={filteredProducts.map((product) => ({
            key: product.id,
            cells: [
              <div key="product" className="min-w-[220px]">
                <p className="text-[15px] font-semibold leading-6 text-text-primary">{product.name}</p>
                <p className="mt-0.5 text-sm text-text-secondary">
                  {product.code}
                  {product.shortName ? ` · ${product.shortName}` : ""}
                </p>
              </div>,
              <span key="unit" className="text-sm text-slate-800">
                {product.unit}
              </span>,
              <span key="order" className="block text-sm font-semibold text-slate-800">
                {product.displayOrder}
              </span>,
              <StatusBadge key="dailyEntry" tone={product.showInDailyEntry ? "info" : "warning"}>
                {product.showInDailyEntry ? "Shown" : "Hidden"}
              </StatusBadge>,
              <StatusBadge key="reconciliation" tone={product.includeInReconciliation ? "info" : "warning"}>
                {product.includeInReconciliation ? "Included" : "Excluded"}
              </StatusBadge>,
              <span key="rate" className="block text-sm font-semibold text-text-primary">
                {formatRate(product.defaultRate)}
              </span>,
              <ActiveStatusToggle
                key="status"
                id={product.id}
                name={product.name}
                isActive={product.isActive}
                recordLabel="product"
                action={setProductActiveState}
              />,
              <div key="actions" className="flex justify-end">
                <ActionButton
                  type="button"
                  icon={<EditIcon className="h-[18px] w-[18px]" />}
                  className="h-8 w-8 rounded-md border-none bg-transparent px-0 text-text-primary shadow-none hover:bg-surface-muted"
                  onClick={() => {
                    setSelectedProductId(product.id);
                    setDialogMode("edit");
                  }}
                  aria-label="Edit product"
                  title="Edit product"
                >
                  <span className="sr-only">Edit product</span>
                </ActionButton>
              </div>,
            ],
          }))}
          emptyMessage="No products match the selected filters"
          minWidth="min-w-[1120px]"
          className="rounded-md border-surface-border shadow-none"
          headClassName="bg-surface-muted/70"
          headerCellClassName="px-5 py-3"
          rowClassName="align-middle hover:bg-surface-muted/60"
          cellClassName="px-5 py-3.5"
        />
      </section>

      {dialogMode ? (
        <ProductDialog
          open
          mode={dialogMode}
          dbConnected={dbConnected}
          draft={dialogMode === "edit" ? productDraft : emptyProductDraft}
          onClose={closeDialog}
        />
      ) : null}
    </>
  );
}
