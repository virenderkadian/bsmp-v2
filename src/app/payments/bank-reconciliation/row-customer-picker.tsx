"use client";

import { useEffect, useRef, useState } from "react";
import { searchCustomersGlobal, type GlobalCustomerSearchResult } from "@/app/masters/actions";
import { getCustomerRoutesForMonth } from "@/app/payments/actions";
import { HighlightMatch } from "@/components/admin/highlight-match";
import { SecondaryButton } from "@/components/admin/buttons";
import { SelectInput } from "@/components/admin/select-input";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import type { OutstandingCandidate } from "@/lib/bank-statement-matching";

export type ConfirmedCustomer = {
  customerId: string;
  customerCode: string;
  customerName: string;
  routeId: string;
};

// One statement row's customer picker: the amount-matched suggestions first
// (one click, route already known from their open bill), with a manual
// search underneath for the unmatched/ambiguous/wrong-suggestion case. A
// customer found by search has no bill in the candidate pool this screen
// already loaded, so their route for this row's month is resolved on
// demand — same lookup the Payments screen's own edit dialog uses.
export function RowCustomerPicker({
  rowDate,
  suggestions,
  selected,
  onSelect,
}: {
  rowDate: string;
  suggestions: OutstandingCandidate[];
  selected: ConfirmedCustomer | null;
  onSelect: (value: ConfirmedCustomer | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalCustomerSearchResult[]>([]);
  const [resolving, setResolving] = useState<GlobalCustomerSearchResult | null>(null);
  const [resolvedRoutes, setResolvedRoutes] = useState<Array<{ id: string; code: string; name: string; shift: string }>>([]);
  const [routeError, setRouteError] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query, 200);
  const requestId = useRef(0);

  useEffect(() => {
    if (debouncedQuery.trim() === "") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }

    searchCustomersGlobal(debouncedQuery).then((found) => {
      setResults(found);
    });
  }, [debouncedQuery]);

  const pickFromSuggestion = (candidate: OutstandingCandidate) => {
    onSelect({
      customerId: candidate.customerId,
      customerCode: candidate.customerCode,
      customerName: candidate.customerName,
      routeId: candidate.routeId,
    });
  };

  const pickFromSearch = async (customer: GlobalCustomerSearchResult) => {
    const id = ++requestId.current;
    setResolving(customer);
    setRouteError(null);
    const routes = await getCustomerRoutesForMonth(customer.id, rowDate.slice(0, 7));
    if (requestId.current !== id) {
      return;
    }

    if (routes.length === 1) {
      onSelect({ customerId: customer.id, customerCode: customer.code, customerName: customer.name, routeId: routes[0].id });
      setResolving(null);
    } else if (routes.length === 0) {
      setRouteError(`${customer.name} has no route on this date — can't attribute this payment.`);
      setResolving(null);
    } else {
      // More than one route this month — needs an explicit pick before this
      // can become a confirmed selection.
      setResolvedRoutes(routes);
    }
  };

  if (selected) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-text-primary">
          {selected.customerCode} · {selected.customerName}
        </span>
        <SecondaryButton type="button" className="h-7 px-2 text-xs" onClick={() => onSelect(null)}>
          Change
        </SecondaryButton>
      </div>
    );
  }

  if (resolving && resolvedRoutes.length > 1) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-secondary">{resolving.name} — which route?</span>
        <SelectInput
          name="rowRoute"
          placeholder="Select route"
          onChange={(event) => {
            const routeId = event.target.value;
            if (!routeId) return;
            onSelect({ customerId: resolving.id, customerCode: resolving.code, customerName: resolving.name, routeId });
            setResolving(null);
            setResolvedRoutes([]);
          }}
          options={resolvedRoutes.map((route) => ({
            value: route.id,
            label: `${route.code} - ${route.name}`,
          }))}
          className="h-8 text-xs"
        />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.slice(0, 4).map((candidate) => (
            <button
              key={candidate.customerId}
              type="button"
              onClick={() => pickFromSuggestion(candidate)}
              className="rounded-md border border-accent/40 bg-accent-soft px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent/20"
            >
              {candidate.customerCode} · {candidate.customerName}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-text-muted">No outstanding customer owes this exact amount.</p>
      )}

      <div className="relative">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search any customer…"
          className="h-8 w-full rounded-md border border-surface-border-strong bg-surface px-2 text-xs outline-none transition focus:border-accent"
        />
        {query.trim() !== "" && results.length > 0 ? (
          <div className="absolute z-10 mt-1 w-full max-w-xs overflow-hidden rounded-md border border-surface-border bg-surface shadow-lg">
            {results.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => {
                  setQuery("");
                  setResults([]);
                  void pickFromSearch(customer);
                }}
                className="block w-full px-3 py-2 text-left text-xs hover:bg-surface-muted"
              >
                <HighlightMatch text={`${customer.code} · ${customer.name}`} query={query} />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {routeError ? <p className="text-xs text-rose-700">{routeError}</p> : null}
    </div>
  );
}
