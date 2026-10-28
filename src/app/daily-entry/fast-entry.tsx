"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { DailyEntryLineRecord, DailyEntryPayload } from "@/lib/daily-entry";
import type { DailyEntryActionState } from "@/app/daily-entry/actions";
import { PrimaryButton } from "@/components/admin/buttons";
import { IconButton } from "@/components/admin/icon-button";
import { XIcon } from "@/components/admin/icons";
import { cn } from "@/lib/utils";

type CommittedRow = {
  customerId: string;
  customerName: string;
  customerCode: string;
  quantities: Record<string, string>;
};

type ActiveCustomer = {
  customerId: string;
  customerName: string;
  customerCode: string;
};

// A tally-register-style entry mode: type a name, Enter through quantities for
// every product in order, Enter on the last one commits the row and jumps
// back to the name field — built for speed, not for editing. Rows are held in
// memory and only written on one explicit "Save all" (see the component
// doc below for why this has to submit EVERY route customer's line, not just
// the ones entered here).
export function FastDailyEntry({
  payload,
  formAction,
  pending,
  state,
}: {
  payload: DailyEntryPayload;
  formAction: (formData: FormData) => void;
  pending: boolean;
  state: DailyEntryActionState;
}) {
  const productColumns = payload.lines[0]?.products ?? [];

  // A customer already has a real entry today the moment any product on
  // their line is non-zero. Re-entering them here would be fine as far as
  // this screen's own state goes, but the save below submits every route
  // customer's CURRENT line verbatim for everyone not touched this session —
  // so letting someone "fast enter" an already-delivered customer would just
  // silently discard what's actually stored unless this screen duplicated the
  // override logic for them too. Simpler and safer: block it, same as a
  // duplicate name within this session, and send them to the regular grid.
  const alreadyEnteredIds = useMemo(() => {
    const ids = new Set<string>();
    payload.lines.forEach((line) => {
      if (line.products.some((product) => Number(product.quantity) > 0)) {
        ids.add(line.customerId);
      }
    });
    return ids;
  }, [payload.lines]);

  const [committed, setCommitted] = useState<CommittedRow[]>([]);
  const committedIds = useMemo(() => new Set(committed.map((row) => row.customerId)), [committed]);

  const [nameQuery, setNameQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeCustomer, setActiveCustomer] = useState<ActiveCustomer | null>(null);
  const [quantities, setQuantities] = useState<string[]>(() => productColumns.map(() => "0"));
  const [blockMessage, setBlockMessage] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const quantityRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Reset this screen's in-memory rows once (and only once) a save for THIS
  // batch actually succeeds — useActionState gives a new state object on
  // every action run, even a resubmit with an identical message, so a plain
  // reference check (not a text comparison) is what tells "a new save just
  // landed" apart from "re-rendered with the same settled state".
  const lastHandledStateRef = useRef<DailyEntryActionState | null>(null);
  useEffect(() => {
    if (state.status !== "success" || lastHandledStateRef.current === state) {
      return;
    }
    lastHandledStateRef.current = state;
    setCommitted([]);
    setActiveCustomer(null);
    setQuantities(productColumns.map(() => "0"));
    setBlockMessage(null);
    requestAnimationFrame(() => nameInputRef.current?.focus());
    // productColumns intentionally omitted: it's derived from payload, which
    // changes together with a successful save anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function isBlocked(customerId: string) {
    return alreadyEnteredIds.has(customerId) || committedIds.has(customerId);
  }

  const suggestions = useMemo(() => {
    const query = nameQuery.trim().toLowerCase();
    if (!query) {
      return [];
    }
    return payload.lines
      .filter(
        (line) =>
          line.customerName.toLowerCase().includes(query) || line.customerCode.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [nameQuery, payload.lines]);

  function focusFirstQuantity() {
    requestAnimationFrame(() => {
      quantityRefs.current[0]?.focus();
      quantityRefs.current[0]?.select();
    });
  }

  function selectCustomer(line: DailyEntryLineRecord) {
    if (isBlocked(line.customerId)) {
      setBlockMessage(`${line.customerName} already has an entry today — edit them on the regular Daily Entry grid instead.`);
      return;
    }
    setBlockMessage(null);
    setActiveCustomer({ customerId: line.customerId, customerName: line.customerName, customerCode: line.customerCode });
    setQuantities(productColumns.map(() => "0"));
    setNameQuery("");
    focusFirstQuantity();
  }

  function commitRow() {
    if (!activeCustomer) {
      return;
    }
    const quantitiesByProduct: Record<string, string> = {};
    productColumns.forEach((column, index) => {
      quantitiesByProduct[column.productId] = quantities[index] || "0";
    });
    setCommitted((rows) => [
      ...rows,
      { customerId: activeCustomer.customerId, customerName: activeCustomer.customerName, customerCode: activeCustomer.customerCode, quantities: quantitiesByProduct },
    ]);
    setActiveCustomer(null);
    setQuantities(productColumns.map(() => "0"));
    requestAnimationFrame(() => nameInputRef.current?.focus());
  }

  function cancelActiveCustomer() {
    setActiveCustomer(null);
    setQuantities(productColumns.map(() => "0"));
    setBlockMessage(null);
    requestAnimationFrame(() => nameInputRef.current?.focus());
  }

  function handleNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const pick = suggestions[activeIndex] ?? suggestions[0];
      if (pick) {
        selectCustomer(pick);
      }
      return;
    }
    if (event.key === "Escape") {
      setNameQuery("");
      setBlockMessage(null);
    }
  }

  function handleQuantityKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelActiveCustomer();
      return;
    }
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    const next = quantityRefs.current[index + 1];
    if (next) {
      next.focus();
      next.select();
      return;
    }
    commitRow();
  }

  function editRow(row: CommittedRow) {
    setCommitted((rows) => rows.filter((item) => item.customerId !== row.customerId));
    setActiveCustomer({ customerId: row.customerId, customerName: row.customerName, customerCode: row.customerCode });
    setQuantities(productColumns.map((column) => row.quantities[column.productId] ?? "0"));
    setBlockMessage(null);
    focusFirstQuantity();
  }

  function removeRow(customerId: string) {
    setCommitted((rows) => rows.filter((row) => row.customerId !== customerId));
  }

  const enteredCount = alreadyEnteredIds.size + committed.length;

  if (payload.lines.length === 0) {
    return <p className="text-sm text-text-secondary">No customers on this route.</p>;
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="routeId" value={payload.selectedRouteId} readOnly />
      <input type="hidden" name="entryDate" value={payload.selectedDate} readOnly />
      <input type="hidden" name="notes" value={payload.notes} readOnly />
      {/* Fast entry never surfaces the unusual-quantity nudge — it's a
          raw-speed tally mode, the regular grid is where that review happens. */}
      <input type="hidden" name="hasUnusualQuantities" value="false" readOnly />

      {/* Every route customer's line, not just the ones entered in this
          session. saveDailyEntry rebuilds the whole route+date from what it's
          given, so a customer left out here would have their existing
          delivery deleted. Untouched customers resubmit their already-saved
          values unchanged — exactly what the regular grid does on every
          save — and only the rows committed below carry typed-in values. */}
      {payload.lines.map((line) => {
        const committedRow = committed.find((row) => row.customerId === line.customerId);

        return (
          <Fragment key={line.customerId}>
            <input type="hidden" name="customerId" value={line.customerId} readOnly />
            <input type="hidden" name="sequenceNo" value={line.sequenceNo} readOnly />
            <input type="hidden" name="remarks" value={line.remarks} readOnly />
            {line.products.map((product) => (
              <Fragment key={product.productId}>
                <input type="hidden" name="productId" value={product.productId} readOnly />
                <input type="hidden" name="productCustomerId" value={line.customerId} readOnly />
                <input type="hidden" name="rateSnapshot" value={product.defaultRate} readOnly />
                <input
                  type="hidden"
                  name="quantity"
                  value={committedRow?.quantities[product.productId] ?? product.quantity}
                  readOnly
                />
              </Fragment>
            ))}
          </Fragment>
        );
      })}

      <div className="rounded-lg border border-surface-border-strong bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Fast entry</h2>
            <p className="text-xs text-text-secondary">
              {enteredCount} / {payload.lines.length} customers entered today
            </p>
          </div>
          <PrimaryButton type="submit" disabled={committed.length === 0 || pending} className="h-10 px-5 text-sm font-semibold">
            {pending ? "Saving..." : `Save all (${committed.length})`}
          </PrimaryButton>
        </div>

        <div className="relative mt-4 max-w-sm">
          <input
            ref={nameInputRef}
            type="text"
            value={nameQuery}
            onChange={(event) => {
              setNameQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleNameKeyDown}
            disabled={activeCustomer !== null}
            placeholder="Type a customer name..."
            autoFocus
            className="h-11 w-full rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent disabled:bg-surface-muted"
          />
          {suggestions.length > 0 ? (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-surface-border-strong bg-surface shadow-lg">
              {suggestions.map((line, index) => {
                const blocked = isBlocked(line.customerId);

                return (
                  <li key={line.customerId}>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        selectCustomer(line);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                        index === activeIndex ? "bg-accent/10" : "hover:bg-surface-muted",
                        blocked && "opacity-50",
                      )}
                    >
                      <span>
                        <span className="font-medium text-text-primary">{line.customerName}</span>{" "}
                        <span className="text-text-secondary">{line.customerCode}</span>
                      </span>
                      {blocked ? <span className="text-xs text-amber-700">already entered</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        {blockMessage ? <p className="mt-2 text-sm text-rose-700">{blockMessage}</p> : null}

        {activeCustomer ? (
          <div className="mt-4 rounded-md border border-accent/40 bg-accent/5 p-3">
            <p className="mb-3 text-sm font-semibold text-text-primary">
              Entering for {activeCustomer.customerName}{" "}
              <span className="font-normal text-text-secondary">{activeCustomer.customerCode}</span>
            </p>
            <div className="flex flex-wrap gap-3">
              {productColumns.map((column, index) => (
                <label key={column.productId} className="flex flex-col gap-1 text-xs text-text-secondary">
                  {column.productShortName ?? column.productName}
                  <input
                    ref={(element) => {
                      quantityRefs.current[index] = element;
                    }}
                    type="number"
                    step="0.001"
                    min="0"
                    value={quantities[index] ?? "0"}
                    onChange={(event) =>
                      setQuantities((current) => current.map((value, i) => (i === index ? event.target.value : value)))
                    }
                    onKeyDown={(event) => handleQuantityKeyDown(event, index)}
                    className="h-10 w-20 rounded-md border border-surface-border-strong bg-surface px-2 text-sm text-text-primary outline-none focus:border-accent"
                  />
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-text-secondary">Enter steps to the next item · Escape cancels this customer</p>
          </div>
        ) : null}

        {committed.length > 0 ? (
          <ul className="mt-4 divide-y divide-surface-border rounded-md border border-surface-border-strong">
            {committed.map((row) => {
              const summary = productColumns
                .filter((column) => Number(row.quantities[column.productId] ?? 0) > 0)
                .map((column) => `${column.productShortName ?? column.productName}: ${row.quantities[column.productId]}`)
                .join(", ");

              return (
                <li key={row.customerId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <button
                    type="button"
                    onClick={() => editRow(row)}
                    title="Click to fix this customer's quantities"
                    className="flex-1 text-left"
                  >
                    <span className="font-medium text-text-primary">{row.customerName}</span>{" "}
                    <span className="text-text-secondary">{summary || "nothing delivered"}</span>
                  </button>
                  <IconButton type="button" tone="danger" onClick={() => removeRow(row.customerId)} aria-label={`Remove ${row.customerName}`}>
                    <XIcon className="h-4 w-4" />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </form>
  );
}
