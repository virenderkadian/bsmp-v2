// The filtering rules behind the recipient picker, kept apart from the component so
// they can be tested directly. A filter only ever changes what is SHOWN.

export type PickerRow = {
  id: string;
  code: string;
  name: string;
  // The figure shown on the right, already formatted.
  detail: string;
  note?: string;
  // Optional, and each filter only appears when the rows carry it: the waiting
  // queue has no route or vehicle, for instance.
  amount?: number;
  routeId?: string;
  routeLabel?: string;
  vehicleId?: string;
  vehicleLabel?: string;
};

export type PickerFilters = {
  search: string;
  routeId: string;
  vehicleId: string;
  // As typed; blank means no limit.
  minAmount: string;
  maxAmount: string;
};

export type Option = { value: string; label: string };

function bound(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function filterRows(rows: PickerRow[], filters: PickerFilters): PickerRow[] {
  const term = filters.search.trim().toLowerCase();
  const min = bound(filters.minAmount);
  const max = bound(filters.maxAmount);

  return rows.filter((row) => {
    if (term && !`${row.code} ${row.name}`.toLowerCase().includes(term)) return false;
    if (filters.routeId && row.routeId !== filters.routeId) return false;
    if (filters.vehicleId && row.vehicleId !== filters.vehicleId) return false;
    if (row.amount !== undefined) {
      if (min !== null && row.amount < min) return false;
      if (max !== null && row.amount > max) return false;
    }
    return true;
  });
}

export function uniqueOptions(rows: PickerRow[], id: "routeId" | "vehicleId", label: "routeLabel" | "vehicleLabel"): Option[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const value = row[id];
    if (value && !seen.has(value)) seen.set(value, row[label] || value);
  }
  return [...seen.entries()]
    .map(([value, text]) => ({ value, label: text }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

// Each dropdown offers only what the other still allows: picking a vehicle narrows
// the routes to that vehicle's, so no combination can come up empty.
export function routeOptionsFor(rows: PickerRow[], vehicleId: string): Option[] {
  return uniqueOptions(vehicleId ? rows.filter((row) => row.vehicleId === vehicleId) : rows, "routeId", "routeLabel");
}

export function vehicleOptionsFor(rows: PickerRow[], routeId: string): Option[] {
  return uniqueOptions(routeId ? rows.filter((row) => row.routeId === routeId) : rows, "vehicleId", "vehicleLabel");
}
