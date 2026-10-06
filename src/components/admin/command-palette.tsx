"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchCustomersGlobal, type GlobalCustomerSearchResult } from "@/app/masters/actions";
import { HighlightMatch } from "@/components/admin/highlight-match";
import { SearchIcon } from "@/components/admin/icons";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";

// App-wide Cmd/Ctrl+K search, mounted once in AppLayout so it works from any
// screen — not scoped to one route the way LoadingBarProvider is. Currently
// searches customers only and opens their portfolio page; the context is
// shaped so another entity type could be added later without moving where
// this is mounted.

type CommandPaletteValue = {
  open: () => void;
};

const CommandPaletteContext = createContext<CommandPaletteValue | null>(null);

export function useCommandPalette(): CommandPaletteValue {
  const value = useContext(CommandPaletteContext);

  if (!value) {
    throw new Error("useCommandPalette must be used inside a CommandPaletteProvider");
  }

  return value;
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  // The one always-on global keyboard shortcut in the app — every other
  // keydown listener here (Dialog, FilterPanel) only listens while its own
  // overlay is open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo<CommandPaletteValue>(() => ({ open }), [open]);

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      <CommandPaletteOverlay open={isOpen} onClose={close} />
    </CommandPaletteContext.Provider>
  );
}

function CommandPaletteOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalCustomerSearchResult[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const debouncedQuery = useDebouncedValue(query, 200);
  const searchRequestId = useRef(0);

  // Reset to a clean slate every time it opens, and lock page scroll /
  // listen for Escape while it's up — the same idiom Dialog uses.
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    // Resetting local state on open, not syncing derived state from this
    // render — the carve-out react-hooks/set-state-in-effect's own guidance
    // makes (same pattern already used in monthly-route-sequence-screen.tsx).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery("");
    setResults([]);
    setHighlightedIndex(0);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const requestId = ++searchRequestId.current;

    if (debouncedQuery.trim() === "") {
      // Clearing a stale result set when there's nothing to search against —
      // not syncing derived state from this render.
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
  }, [debouncedQuery, open]);

  const select = (customerId: string) => {
    onClose();
    router.push(`/customers/${customerId}`);
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
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[15vh]">
      <button
        type="button"
        aria-label="Close search"
        className="absolute inset-0 bg-slate-950/50"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Search customers"
        className="relative z-10 flex max-h-[60vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-surface-border px-4 py-3">
          <SearchIcon className="h-5 w-5 shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search customers by name, code, area, or phone…"
            className="h-8 w-full border-0 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
          <kbd className="shrink-0 rounded border border-surface-border-strong px-1.5 py-0.5 text-xs text-text-muted">
            Esc
          </kbd>
        </div>

        <div className="overflow-y-auto">
          {query.trim() === "" ? (
            <p className="px-4 py-6 text-center text-sm text-text-secondary">
              Start typing a customer&apos;s name, code, area, or phone number.
            </p>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-text-secondary">No customers found.</p>
          ) : (
            results.map((customer, index) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => select(customer.id)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={cn(
                  "flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left transition",
                  index === highlightedIndex ? "bg-accent-soft" : "bg-surface hover:bg-surface-muted",
                )}
              >
                <span>
                  <span className="block text-sm font-semibold text-text-primary">
                    <HighlightMatch text={customer.name} query={query} />
                  </span>
                  <span className="mt-0.5 block text-xs font-medium uppercase tracking-[0.12em] text-text-secondary">
                    <HighlightMatch
                      text={[customer.code, customer.area, customer.mobile].filter(Boolean).join(" · ")}
                      query={query}
                    />
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
