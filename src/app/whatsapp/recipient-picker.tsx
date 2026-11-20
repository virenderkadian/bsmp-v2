"use client";

import { useMemo, useState } from "react";
import { SecondaryButton } from "@/components/admin/buttons";
import { SearchInput } from "@/components/admin/search-input";

export type PickerRow = { id: string; code: string; name: string; detail: string; note?: string };

// A list of customers with a tick box each: untick to take someone out, tick to put
// them back. Used before queueing (reminders, bills) and on the waiting queue
// (removing). Selection lives in the parent so it can act on exactly what is ticked.
//
// "Select all" and "Clear" act on what the search is showing, so a search for one
// route's customers followed by Clear removes just those, not the whole list.
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

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? rows.filter((row) => `${row.code} ${row.name}`.toLowerCase().includes(term)) : rows;
  }, [rows, search]);

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by code or name" />
        </div>
        <SecondaryButton type="button" onClick={() => setVisible(true)} disabled={disabled || visible.length === 0}>
          Select all
        </SecondaryButton>
        <SecondaryButton type="button" onClick={() => setVisible(false)} disabled={disabled || visible.length === 0}>
          Clear
        </SecondaryButton>
      </div>

      <p className="text-sm text-text-secondary">
        {selected.size} of {rows.length} selected
        {search.trim() ? ` · showing ${visible.length}` : ""}
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
              {row.note ? <span className="shrink-0 text-xs text-text-muted">{row.note}</span> : null}
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
