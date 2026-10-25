"use client";

import { useEffect, useRef, useState } from "react";
import { searchCustomersGlobal, type GlobalCustomerSearchResult } from "@/app/masters/actions";
import { HighlightMatch } from "@/components/admin/highlight-match";
import { SearchIcon } from "@/components/admin/icons";
import { useLoadingBar } from "@/components/admin/loading-bar";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";

// A compact, inline version of the Cmd/Ctrl+K search (command-palette.tsx) —
// reuses the same search action and highlight rendering, but sits directly
// on the page instead of a full-screen overlay, so staff reviewing one
// customer's month can jump straight to another's without leaving this
// screen first. Keeps the month currently being viewed when it navigates,
// since the usual reason to switch customers here is checking the same
// month across several of them in a row.
export function CustomerSwitcher({ currentCustomerName, month }: { currentCustomerName: string; month: string }) {
  const { navigate } = useLoadingBar();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalCustomerSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const debouncedQuery = useDebouncedValue(query, 200);
  const searchRequestId = useRef(0);

  useEffect(() => {
    const requestId = ++searchRequestId.current;

    if (debouncedQuery.trim() === "") {
      // Clearing a stale result set when there's nothing to search against —
      // not syncing derived state from this render (same carve-out used in
      // command-palette.tsx's identical case).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }

    searchCustomersGlobal(debouncedQuery).then((found) => {
      if (searchRequestId.current === requestId) {
        setResults(found);
        setHighlightedIndex(0);
      }
    });
  }, [debouncedQuery]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const select = (customerId: string) => {
    setOpen(false);
    setQuery("");
    navigate(`/customers/${customerId}/monthly-deliveries?month=${month}`);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = results[highlightedIndex];
      if (selected) {
        select(selected.id);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-xs">
      <div className="flex h-10 items-center gap-2 rounded-lg border border-surface-border-strong bg-surface px-3 transition focus-within:border-accent">
        <SearchIcon className="h-4 w-4 shrink-0 text-text-muted" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={`Switch from ${currentCustomerName}…`}
          className="h-full w-full border-0 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
        />
      </div>

      {open && query.trim() !== "" ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-surface-border bg-surface shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-text-secondary">No customers found.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {results.map((customer, index) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => select(customer.id)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={cn(
                    "flex w-full items-center justify-between gap-4 px-3 py-2 text-left transition",
                    index === highlightedIndex ? "bg-accent-soft" : "bg-surface hover:bg-surface-muted",
                  )}
                >
                  <span>
                    <span className="block text-sm font-semibold text-text-primary">
                      <HighlightMatch text={customer.name} query={query} />
                    </span>
                    <span className="mt-0.5 block text-xs text-text-secondary">
                      <HighlightMatch
                        text={[customer.code, customer.area, customer.mobile].filter(Boolean).join(" · ")}
                        query={query}
                      />
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
