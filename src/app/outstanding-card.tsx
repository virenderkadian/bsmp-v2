"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney, SummaryCard, type SummaryCardProps } from "@/app/summary-card";
import { Dialog } from "@/components/admin/dialog";
import type { OutstandingCustomer } from "@/lib/dashboard-outstanding";
import { cn } from "@/lib/utils";

type SortKey = "highest" | "lowest" | "code" | "name";

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: "highest", label: "Highest first" },
  { value: "lowest", label: "Lowest first" },
  { value: "code", label: "Customer code" },
  { value: "name", label: "Customer name" },
];

const controlClass =
  "h-9 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition-colors focus:border-accent";

function toggled(set: Set<string>, id: string) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// A dropdown of checkboxes. Chips were fine for two vehicles and unusable for twenty routes.
function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const summary =
    selected.size === 0
      ? "All"
      : selected.size === 1
        ? (options.find((option) => selected.has(option.id))?.label ?? "1 selected")
        : `${selected.size} selected`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(controlClass, "flex w-full min-w-40 items-center justify-between gap-2 text-left hover:bg-surface-muted")}
      >
        <span className="min-w-0 truncate">
          <span className="text-text-secondary">{label}: </span>
          <span className={selected.size > 0 ? "font-medium" : undefined}>{summary}</span>
        </span>
        <span aria-hidden="true" className="text-xs text-text-muted">
          ▾
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-surface-border bg-surface p-1.5 shadow-lg">
          {options.length === 0 ? (
            <p className="px-2 py-2 text-sm text-text-secondary">Nothing to choose</p>
          ) : (
            <ul role="listbox" aria-multiselectable="true" aria-label={label} className="max-h-60 overflow-y-auto">
              {options.map((option) => (
                <li key={option.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-primary hover:bg-surface-muted">
                    <input
                      type="checkbox"
                      checked={selected.has(option.id)}
                      onChange={() => onChange(toggled(selected, option.id))}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    <span className="min-w-0 truncate">{option.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {selected.size > 0 ? (
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="mt-1 w-full rounded-md border-t border-surface-border px-2 pt-2 pb-1 text-left text-xs font-medium text-text-secondary hover:text-text-primary"
            >
              Clear selection
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function sortRows(rows: OutstandingCustomer[], sort: SortKey) {
  const copy = [...rows];
  const byCode = (a: OutstandingCustomer, b: OutstandingCustomer) =>
    a.customerCode.localeCompare(b.customerCode, undefined, { numeric: true });
  switch (sort) {
    case "highest":
      return copy.sort((a, b) => b.outstanding - a.outstanding || byCode(a, b));
    case "lowest":
      return copy.sort((a, b) => a.outstanding - b.outstanding || byCode(a, b));
    case "name":
      return copy.sort((a, b) => a.customerName.localeCompare(b.customerName) || byCode(a, b));
    default:
      return copy.sort(byCode);
  }
}

// Who owes what, as of now. The vehicle and route filters narrow the list and its total together,
// and the toolbar stays fixed while the list scrolls, so the total is always in view.
export function OutstandingCard({
  face,
  customers,
}: {
  face: Omit<SummaryCardProps, "onClick" | "hint">;
  customers: OutstandingCustomer[];
}) {
  const [open, setOpen] = useState(false);
  const [vehicles, setVehicles] = useState<Set<string>>(new Set());
  const [routes, setRoutes] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("highest");

  const vehicleOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customers) map.set(customer.vehicleId, customer.vehicleLabel);
    return [...map].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [customers]);

  // Routes offered follow the vehicles picked, so the two filters never contradict each other.
  const routeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customers) {
      if (vehicles.size === 0 || vehicles.has(customer.vehicleId)) map.set(customer.routeId, customer.routeLabel);
    }
    return [...map].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [customers, vehicles]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = customers.filter(
      (customer) =>
        (vehicles.size === 0 || vehicles.has(customer.vehicleId)) &&
        (routes.size === 0 || routes.has(customer.routeId)) &&
        (needle === "" || customer.customerName.toLowerCase().includes(needle) || customer.customerCode.toLowerCase().includes(needle)),
    );
    return sortRows(filtered, sort);
  }, [customers, vehicles, routes, query, sort]);

  const shownTotal = shown.reduce((sum, customer) => sum + customer.outstanding, 0);
  const filtered = vehicles.size > 0 || routes.size > 0 || query.trim() !== "";

  const changeVehicles = (next: Set<string>) => {
    setVehicles(next);
    // Drop route picks that no longer belong to a picked vehicle.
    if (next.size > 0) {
      const allowed = new Set(customers.filter((customer) => next.has(customer.vehicleId)).map((customer) => customer.routeId));
      setRoutes(new Set([...routes].filter((routeId) => allowed.has(routeId))));
    }
  };

  const clearAll = () => {
    setVehicles(new Set());
    setRoutes(new Set());
    setQuery("");
  };

  const toolbar = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search customer name or code"
          aria-label="Search customers"
          className={cn(controlClass, "min-w-48 flex-1")}
        />
        <MultiSelect label="Vehicle" options={vehicleOptions} selected={vehicles} onChange={changeVehicles} />
        <MultiSelect label="Route" options={routeOptions} selected={routes} onChange={setRoutes} />
        <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Sort by" className={cn(controlClass, "pr-8")}>
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-end justify-between gap-4">
        <p className="text-sm text-text-secondary">
          <span className="font-medium text-text-primary tabular-nums">{shown.length}</span> of{" "}
          <span className="tabular-nums">{customers.length}</span> customers
          {filtered ? (
            <button type="button" onClick={clearAll} className="ml-3 text-xs font-medium text-text-secondary underline-offset-2 hover:text-text-primary hover:underline">
              Clear filters
            </button>
          ) : null}
        </p>
        <p className="text-right">
          <span className="block text-xs text-text-secondary">{filtered ? "Outstanding in this view" : "Total outstanding"}</span>
          <span className="text-xl font-semibold tabular-nums text-text-primary">{formatMoney(shownTotal)}</span>
        </p>
      </div>
    </div>
  );

  return (
    <>
      <SummaryCard {...face} onClick={() => setOpen(true)} hint="Click for the customer list" />
      <Dialog
        open={open}
        size="xl"
        title="Customer outstanding"
        description="Customers who owe on their latest bill, as of now."
        toolbar={toolbar}
        onClose={() => setOpen(false)}
      >
        {customers.length === 0 ? (
          <p className="py-16 text-center text-sm text-text-secondary">No customer owes anything right now.</p>
        ) : shown.length === 0 ? (
          <p className="py-16 text-center text-sm text-text-secondary">No customers match these filters.</p>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs text-text-secondary">
                <th className="sticky top-0 z-10 border-b border-surface-border bg-surface py-2.5 pr-3 font-medium">Customer</th>
                <th className="sticky top-0 z-10 border-b border-surface-border bg-surface py-2.5 pr-3 font-medium">Route</th>
                <th className="sticky top-0 z-10 hidden border-b border-surface-border bg-surface py-2.5 pr-3 font-medium md:table-cell">Vehicle</th>
                <th className="sticky top-0 z-10 border-b border-surface-border bg-surface py-2.5 text-right font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((customer) => (
                <tr key={customer.customerId} className="hover:bg-surface-muted">
                  <td className="border-b border-surface-border py-2.5 pr-3">
                    <div className="font-medium text-text-primary">{customer.customerName}</div>
                    <div className="text-xs text-text-secondary">{customer.customerCode}</div>
                  </td>
                  <td className="border-b border-surface-border py-2.5 pr-3 text-text-primary">
                    <div>{customer.routeLabel}</div>
                    <div className="text-xs text-text-secondary md:hidden">{customer.vehicleLabel}</div>
                  </td>
                  <td className="hidden border-b border-surface-border py-2.5 pr-3 text-text-primary md:table-cell">{customer.vehicleLabel}</td>
                  <td className="border-b border-surface-border py-2.5 text-right font-medium tabular-nums text-text-primary">
                    {formatMoney(customer.outstanding)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Dialog>
    </>
  );
}
