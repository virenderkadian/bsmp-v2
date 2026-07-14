"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { createCity, setCityActiveState, type ActionState, updateCity } from "@/app/settings/city-actions";
import { ActiveStatusToggle } from "@/components/admin/active-status-toggle";
import { ActionButton, PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { DataTable } from "@/components/admin/data-table";
import { Dialog } from "@/components/admin/dialog";
import { FormInput } from "@/components/admin/form-input";
import { EditIcon, PlusIcon } from "@/components/admin/icons";
import { KeyboardForm } from "@/components/admin/keyboard-form";
import { SearchInput } from "@/components/admin/search-input";
import { StatusBadge } from "@/components/admin/status-badge";
import type { CityRecord } from "@/lib/settings";

const initialState: ActionState = { status: "idle" };

type CityDraft = {
  id?: string;
  code: string;
  name: string;
};

const emptyDraft: CityDraft = { code: "", name: "" };

function CityDialog({
  open,
  mode,
  dbConnected,
  draft,
  onClose,
}: {
  open: boolean;
  mode: "create" | "edit";
  dbConnected: boolean;
  draft: CityDraft;
  onClose: () => void;
}) {
  const [createState, createAction, createPending] = useActionState(createCity, initialState);
  const [updateState, updateAction, updatePending] = useActionState(updateCity, initialState);
  const state = mode === "create" ? createState : updateState;
  const pending = mode === "create" ? createPending : updatePending;

  useEffect(() => {
    if (open && state.status === "success") {
      onClose();
    }
  }, [onClose, open, state.status]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "create" ? "Add city" : "Edit city"}
      description="Each city has its own routes, customers, products, and business profile."
      footer={null}
    >
      <KeyboardForm action={mode === "create" ? createAction : updateAction} className="space-y-4">
        {mode === "edit" && draft.id ? <input type="hidden" name="id" value={draft.id} /> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <FormInput label="Code" name="code" placeholder="ROHTAK" defaultValue={draft.code} autoFocus />
          <FormInput label="City name" name="name" placeholder="Rohtak" defaultValue={draft.name} />
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
          <SecondaryButton type="button" onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={pending}>
            {pending ? "Saving..." : mode === "create" ? "Save city" : "Update city"}
          </PrimaryButton>
        </div>
      </KeyboardForm>
    </Dialog>
  );
}

export function CitiesPanel({ dbConnected, cities }: { dbConnected: boolean; cities: CityRecord[] }) {
  const [search, setSearch] = useState("");
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);

  const filteredCities = useMemo(() => {
    const query = search.toLowerCase().trim();
    return cities.filter(
      (city) =>
        query === "" || city.code.toLowerCase().includes(query) || city.name.toLowerCase().includes(query),
    );
  }, [cities, search]);

  const selectedCity = cities.find((city) => city.id === selectedCityId);
  const draft: CityDraft = selectedCity
    ? { id: selectedCity.id, code: selectedCity.code, name: selectedCity.name }
    : emptyDraft;

  const closeDialog = () => {
    setDialogMode(null);
    setSelectedCityId(null);
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Cities</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Every city keeps its own routes, customers, products, and business profile.
          </p>
        </div>
        <PrimaryButton
          type="button"
          icon={<PlusIcon className="h-4 w-4" />}
          className="h-10 rounded-md px-5 text-sm font-semibold"
          onClick={() => {
            setSelectedCityId(null);
            setDialogMode("create");
          }}
        >
          Add city
        </PrimaryButton>
      </div>

      <div className="flex items-center gap-3">
        <SearchInput
          name="citySearch"
          placeholder="Search city"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-xs"
        />
        {dbConnected ? null : <StatusBadge tone="warning">Offline fallback</StatusBadge>}
      </div>

      <DataTable
        columns={[
          { key: "city", label: "City" },
          { key: "status", label: "Status" },
          { key: "actions", label: "Actions", className: "text-right", headerClassName: "text-right" },
        ]}
        rows={filteredCities.map((city) => ({
          key: city.id,
          cells: [
            <div key="city" className="min-w-[200px]">
              <p className="text-[15px] font-semibold leading-6 text-text-primary">{city.name}</p>
              <p className="mt-0.5 text-sm text-text-secondary">{city.code}</p>
            </div>,
            <ActiveStatusToggle
              key="status"
              id={city.id}
              name={city.name}
              isActive={city.isActive}
              recordLabel="city"
              action={setCityActiveState}
            />,
            <div key="actions" className="flex justify-end">
              <ActionButton
                type="button"
                icon={<EditIcon className="h-[18px] w-[18px]" />}
                className="h-8 w-8 rounded-md border-none bg-transparent px-0 text-text-primary shadow-none hover:bg-surface-muted"
                onClick={() => {
                  setSelectedCityId(city.id);
                  setDialogMode("edit");
                }}
                aria-label="Edit city"
                title="Edit city"
              >
                <span className="sr-only">Edit city</span>
              </ActionButton>
            </div>,
          ],
        }))}
        emptyMessage="No cities match your search"
        minWidth="min-w-[520px]"
        className="rounded-md border-surface-border shadow-none"
        headClassName="bg-surface-muted/70"
        headerCellClassName="px-5 py-3"
        rowClassName="align-middle hover:bg-surface-muted/60"
        cellClassName="px-5 py-3.5"
      />

      {dialogMode ? (
        <CityDialog
          open
          mode={dialogMode}
          dbConnected={dbConnected}
          draft={dialogMode === "edit" ? draft : emptyDraft}
          onClose={closeDialog}
        />
      ) : null}
    </section>
  );
}
