"use client";

import { useMemo, useState } from "react";
import { SecondaryButton } from "@/components/admin/buttons";
import { FormInput } from "@/components/admin/form-input";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";
import { filterRows, routeOptionsFor, vehicleOptionsFor, type PickerRow } from "@/app/whatsapp/recipient-filter";

// A list of customers with a tick box each: untick to take someone out, tick to put
// them back. Used before queueing (reminders, bills) and on the waiting queue
// (removing). Selection lives in the parent so it can act on exactly what is ticked.
//
// Filters (search, route, vehicle, amount range) only change what is SHOWN. Select
// all, Clear and Only these act on what is shown, so "this route, over ₹1,000, only
// these" is three clicks and the ticks outside the view are never touched except by
// Only these, which is meant to.
export function RecipientPicker({
  rows,
  selected,
  onChange,
  disabled = false,
  detailHeading,
}: {
  rows: PickerRow[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
  detailHeading?: string;
}) {
  const [search, setSearch] = useState("");
  const [routeId, setRouteId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");

  const hasRoutes = rows.some((row) => row.routeId);
  const hasVehicles = rows.some((row) => row.vehicleId);
  const hasAmounts = rows.some((row) => row.amount !== undefined);

  // Each dropdown offers only what the other still allows, so picking a vehicle
  // narrows the routes to that vehicle's and never leaves an empty combination.
  const routeOptions = useMemo(() => routeOptionsFor(rows, vehicleId), [rows, vehicleId]);
  const vehicleOptions = useMemo(() => vehicleOptionsFor(rows, routeId), [rows, routeId]);

  const visible = useMemo(
    () => filterRows(rows, { search, routeId, vehicleId, minAmount, maxAmount }),
    [rows, search, routeId, vehicleId, minAmount, maxAmount],
  );

  const filtered = visible.length !== rows.length;
  const filtersActive = Boolean(search.trim() || routeId || vehicleId || minAmount.trim() || maxAmount.trim());

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const setVisible = (checked: boolean) => {
    const next = new Set(selected);
    for (const row of visible) {
      if (checked) next.add(row.id);
      else next.delete(row.id);
    }
    onChange(next);
  };

  // Exactly what is shown, nothing else: the quick way to narrow a full list to
  // one route or one amount band.
  const onlyThese = () => onChange(new Set(visible.map((row) => row.id)));

  const reset = () => {
    setSearch("");
    setRouteId("");
    setVehicleId("");
    setMinAmount("");
    setMaxAmount("");
  };

  const selectedVisible = visible.filter((row) => selected.has(row.id)).length;

  return (
    <div className="space-y-3">
      <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by code or name" />

      {hasRoutes || hasVehicles || hasAmounts ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {hasRoutes ? (
            <SelectInput
              label="Route"
              value={routeId}
              onChange={(event) => setRouteId(event.target.value)}
              placeholder="All routes"
              options={routeOptions}
            />
          ) : null}
          {hasVehicles ? (
            <SelectInput
              label="Vehicle"
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
              placeholder="All vehicles"
              options={vehicleOptions}
            />
          ) : null}
          {hasAmounts ? (
            <>
              <FormInput
                label="Amount from (₹)"
                type="number"
                inputMode="decimal"
                min={0}
                value={minAmount}
                onChange={(event) => setMinAmount(event.target.value)}
                placeholder="No minimum"
              />
              <FormInput
                label="Amount up to (₹)"
                type="number"
                inputMode="decimal"
                min={0}
                value={maxAmount}
                onChange={(event) => setMaxAmount(event.target.value)}
                placeholder="No maximum"
              />
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <SecondaryButton type="button" onClick={() => setVisible(true)} disabled={disabled || visible.length === 0}>
          Select all shown
        </SecondaryButton>
        <SecondaryButton type="button" onClick={() => setVisible(false)} disabled={disabled || visible.length === 0}>
          Clear shown
        </SecondaryButton>
        {filtered ? (
          <SecondaryButton type="button" onClick={onlyThese} disabled={disabled || visible.length === 0}>
            Only these {visible.length}
          </SecondaryButton>
        ) : null}
        {filtersActive ? (
          <SecondaryButton type="button" onClick={reset}>
            Reset filters
          </SecondaryButton>
        ) : null}
      </div>

      <p className="text-sm text-text-secondary">
        {selected.size} of {rows.length} selected
        {filtered ? ` · showing ${visible.length} (${selectedVisible} ticked)` : ""}
      </p>

      <ul className="max-h-96 divide-y divide-surface-border overflow-auto rounded-lg border border-surface-border">
        {visible.length === 0 ? <li className="p-3 text-sm text-text-muted">No customers match.</li> : null}
        {visible.map((row) => (
          <li key={row.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-muted">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                checked={selected.has(row.id)}
                onChange={() => toggle(row.id)}
                disabled={disabled}
              />
              <span className="min-w-0 flex-1 truncate text-text-primary">
                {row.code} · {row.name}
              </span>
              {row.routeLabel || row.note ? (
                <span className="hidden shrink-0 text-xs text-text-muted sm:inline">
                  {row.note ?? row.routeLabel?.split(" - ")[0]}
                </span>
              ) : null}
              <span className="shrink-0 font-medium tabular-nums text-text-primary" title={detailHeading}>
                {row.detail}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
